//! SQLite (rusqlite). Funções recebem `&Connection` para teste com `Connection::open_in_memory()`.
//! Escritas de várias linhas rodam em transação. Migrações via `PRAGMA user_version`.

use super::extract::{self, variant_matches};
use super::http::{check_http_url, FailKind, PollOutcome};
use super::model::*;
use super::scheduler;
use super::stats::{self, PricedSpan, RecordOutcome};
use super::templates;
use chrono::{DateTime, FixedOffset, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

pub fn dberr(e: rusqlite::Error) -> String {
    format!("Erro no banco de dados: {e}")
}

pub fn ts(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

// ---------------------------------------------------------------- abertura/migração

const SCHEMA_V1: &str = "
CREATE TABLE items(
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  budget_unit_cents INTEGER,
  target_cents INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  bought INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  specs TEXT NOT NULL DEFAULT '{}',
  template_id TEXT,
  model_token TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE offers(
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  store TEXT NOT NULL,
  url TEXT,
  title TEXT,
  sku TEXT,
  adapter TEXT NOT NULL,
  shipping_cents INTEGER,
  shipping_note TEXT,
  pix_discount_pct REAL,
  status TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_checked_at TEXT,
  next_poll_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX offers_item ON offers(item_id);
CREATE INDEX offers_due ON offers(next_poll_at);
CREATE TABLE observations(
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  list_cents INTEGER,
  cash_cents INTEGER,
  installments_text TEXT,
  in_stock INTEGER,
  source TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  error TEXT
);
CREATE INDEX obs_offer ON observations(offer_id, first_seen_at);
CREATE TABLE purchases(
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  paid_unit_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  store TEXT NOT NULL DEFAULT '',
  purchased_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE templates(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fields TEXT NOT NULL
);
CREATE TABLE settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

const SCHEMA_V2: &str = "
CREATE TABLE alert_rules(
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  target_cents INTEGER,
  notify_new_low INTEGER NOT NULL DEFAULT 1,
  snooze_until TEXT,
  last_alert_cents INTEGER,
  last_alert_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE alert_events(
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  offer_id TEXT,
  kind TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  prev_cents INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  delivered_desktop INTEGER NOT NULL DEFAULT 0,
  delivered_discord INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX alert_events_created ON alert_events(created_at);
CREATE INDEX alert_events_item ON alert_events(item_id);
INSERT INTO alert_rules(item_id, enabled, target_cents, notify_new_low, updated_at)
  SELECT id, 1, target_cents, 1, updated_at FROM items WHERE target_cents IS NOT NULL;
";

/// v3: cômodo e arquivamento. Prioridade passa a ter 3 níveis (0 "Um dia", 1 "Em breve", 2 "Agora"):
/// o que era 0 (normal) vira 1 e o que era 1 (alta) vira 2.
const SCHEMA_V3: &str = "
ALTER TABLE items ADD COLUMN room TEXT;
ALTER TABLE items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
UPDATE items SET priority = priority + 1 WHERE priority IN (0, 1);
";

/// Versão do esquema que este aplicativo entende.
pub const SCHEMA_VERSION: i64 = 3;

/// Caminho do arquivo do banco (None para banco em memória).
fn db_file_path(conn: &Connection) -> Option<std::path::PathBuf> {
    let file: String = conn
        .query_row("SELECT file FROM pragma_database_list WHERE name='main'", [], |r| r.get(0))
        .ok()?;
    if file.trim().is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(file))
    }
}

/// Copia consistente do banco (`VACUUM INTO`) antes de migrar um arquivo: `<nome>.bak-v{antiga}-{yyyymmddHHMM}`.
/// Falhar aqui aborta a migração (os dados ficam como estavam).
fn backup_before_migration(conn: &Connection, old_version: i64) -> Result<Option<std::path::PathBuf>, String> {
    let Some(file) = db_file_path(conn) else {
        return Ok(None);
    };
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "compras.db".to_string());
    let stamp = chrono::Local::now().format("%Y%m%d%H%M").to_string();
    let dir = file.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let mut target = dir.join(format!("{name}.bak-v{old_version}-{stamp}"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{name}.bak-v{old_version}-{stamp}-{n}"));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", params![target.to_string_lossy()])
        .map_err(|e| format!("Não foi possível fazer a cópia de segurança do banco antes de atualizar: {e}"))?;
    Ok(Some(target))
}

pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", "ON").map_err(dberr)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(dberr)?;
    if version > SCHEMA_VERSION {
        return Err("O banco de dados de Compras é de uma versão mais nova que este aplicativo.".to_string());
    }
    if version >= 1 && version < SCHEMA_VERSION {
        backup_before_migration(conn, version)?;
    }
    if version < 1 {
        let tx = conn.unchecked_transaction().map_err(dberr)?;
        tx.execute_batch(SCHEMA_V1).map_err(dberr)?;
        tx.pragma_update(None, "user_version", 1).map_err(dberr)?;
        tx.commit().map_err(dberr)?;
    }
    if version < 2 {
        let tx = conn.unchecked_transaction().map_err(dberr)?;
        tx.execute_batch(SCHEMA_V2).map_err(dberr)?;
        tx.pragma_update(None, "user_version", 2).map_err(dberr)?;
        tx.commit().map_err(dberr)?;
    }
    if version < 3 {
        let tx = conn.unchecked_transaction().map_err(dberr)?;
        tx.execute_batch(SCHEMA_V3).map_err(dberr)?;
        tx.pragma_update(None, "user_version", 3).map_err(dberr)?;
        tx.commit().map_err(dberr)?;
    }
    if version == 1 {
        // dados antigos: itens que já estão no alvo não devem disparar aviso de uma vez no primeiro poll
        // (depois da v3, pois `load_views` lê as colunas novas)
        let _ = prime_alert_rules(conn);
    }
    seed_templates(conn)
}

/// Pós-migração v1->v2: para regras cujo preço atual já está no alvo, grava o estado "já avisado"
/// (sem evento, sem toast). Melhor esforço.
fn prime_alert_rules(conn: &Connection) -> Result<usize, String> {
    let settings = load_settings(conn);
    let tz = *chrono::Local::now().offset();
    let today = chrono::Local::now().date_naive();
    let now = ts(Utc::now());
    let views = load_views(conn, None, &settings, today, tz, Path::new("."))?;
    let mut n = 0;
    for v in views {
        let (Some(rule), Some(cand)) = (&v.alert, super::alerts::candidate_of(&v)) else { continue };
        if v.item.bought {
            continue;
        }
        if rule.target_cents.map(|t| cand.final_cents <= t).unwrap_or(false) {
            set_alert_state(conn, &v.item.id, Some(cand.final_cents), Some(&now))?;
            n += 1;
        }
    }
    Ok(n)
}

fn seed_templates(conn: &Connection) -> Result<(), String> {
    for t in templates::seed_templates() {
        let fields = serde_json::to_string(&t.fields).map_err(|e| e.to_string())?;
        conn.execute("INSERT OR IGNORE INTO templates(id, name, fields) VALUES (?1, ?2, ?3)", params![t.id, t.name, fields])
            .map_err(dberr)?;
    }
    Ok(())
}

pub fn open_file(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar a pasta de Compras: {e}"))?;
    }
    let conn = Connection::open(path).map_err(dberr)?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let _: Result<String, _> = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0));
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_memory() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(dberr)?;
    migrate(&conn)?;
    Ok(conn)
}

// ---------------------------------------------------------------- settings

pub fn load_settings(conn: &Connection) -> ComprasSettings {
    conn.query_row("SELECT value FROM settings WHERE key='settings'", [], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<ComprasSettings>(&s).ok())
        .unwrap_or_default()
}

/// Valida/normaliza e grava. Intervalo 60..180; mínimo da Amazon 360..1440; Pix 0..100.
pub fn save_settings(conn: &Connection, mut s: ComprasSettings) -> Result<ComprasSettings, String> {
    s.poll_interval_minutes = s.poll_interval_minutes.clamp(scheduler::MIN_INTERVAL_MIN, scheduler::MAX_INTERVAL_MIN);
    s.amazon_min_interval_minutes = s.amazon_min_interval_minutes.clamp(360, 1440);
    s.cep = s.cep.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    s.pix_discount_by_store.retain(|k, v| !k.trim().is_empty() && v.is_finite() && *v >= 0.0 && *v < 100.0);
    s.cooldown_hours = s.cooldown_hours.clamp(1, 720);
    s.realert_drop_pct = if s.realert_drop_pct.is_finite() { s.realert_drop_pct.clamp(0.0, 100.0) } else { 3.0 };
    s.max_toasts_per_cycle = s.max_toasts_per_cycle.clamp(1, 20);
    s.default_target_pct = if s.default_target_pct.is_finite() { s.default_target_pct.clamp(1.0, 90.0) } else { 10.0 };
    // horário silencioso: os dois "HH:MM" válidos, senão desligado
    let quiet = match (s.quiet_start.as_deref().and_then(super::alerts::normalize_hhmm), s.quiet_end.as_deref().and_then(super::alerts::normalize_hhmm)) {
        (Some(a), Some(b)) => (Some(a), Some(b)),
        _ => (None, None),
    };
    s.quiet_start = quiet.0;
    s.quiet_end = quiet.1;
    let mut rooms: Vec<String> = Vec::new();
    for r in s.rooms.drain(..) {
        let r = r.trim().to_string();
        if !r.is_empty() && !rooms.iter().any(|x| x.eq_ignore_ascii_case(&r)) {
            rooms.push(r);
        }
    }
    s.rooms = rooms;
    let json = serde_json::to_string(&s).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO settings(key, value) VALUES('settings', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![json])
        .map_err(dberr)?;
    Ok(s)
}

// ---------------------------------------------------------------- templates

pub fn list_templates(conn: &Connection) -> Result<Vec<CategoryTemplate>, String> {
    let mut stmt = conn.prepare("SELECT id, name, fields FROM templates ORDER BY rowid").map_err(dberr)?;
    let rows = stmt
        .query_map([], |r| {
            let fields: String = r.get(2)?;
            Ok(CategoryTemplate {
                id: r.get(0)?,
                name: r.get(1)?,
                fields: serde_json::from_str(&fields).unwrap_or_default(),
            })
        })
        .map_err(dberr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(dberr)
}

pub fn upsert_template(conn: &Connection, mut t: CategoryTemplate) -> Result<CategoryTemplate, String> {
    t.name = t.name.trim().to_string();
    if t.name.is_empty() {
        return Err("Informe o nome do template.".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for f in &mut t.fields {
        f.key = f.key.trim().to_string();
        f.label = f.label.trim().to_string();
        if f.key.is_empty() {
            return Err("Todo campo do template precisa de uma chave.".to_string());
        }
        if !matches!(f.kind.as_str(), "text" | "number" | "bool" | "enum") {
            return Err(format!("Tipo de campo inválido: {}", f.kind));
        }
        if !seen.insert(f.key.clone()) {
            return Err(format!("Chave de campo repetida: {}", f.key));
        }
    }
    if t.id.trim().is_empty() {
        t.id = uuid::Uuid::new_v4().to_string();
    }
    let fields = serde_json::to_string(&t.fields).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO templates(id, name, fields) VALUES(?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name, fields=excluded.fields",
        params![t.id, t.name, fields],
    )
    .map_err(dberr)?;
    Ok(t)
}

// ---------------------------------------------------------------- itens

const ITEM_COLS: &str = "id, category, name, qty, budget_unit_cents, target_cents, notes, bought, image_path, specs, template_id, model_token, priority, created_at, updated_at, room, archived";

fn row_item(r: &Row) -> rusqlite::Result<ComprasItem> {
    let specs: String = r.get(9)?;
    Ok(ComprasItem {
        id: r.get(0)?,
        category: r.get(1)?,
        name: r.get(2)?,
        qty: r.get(3)?,
        budget_unit_cents: r.get(4)?,
        target_cents: r.get(5)?,
        notes: r.get(6)?,
        bought: r.get::<_, i64>(7)? != 0,
        image_path: r.get(8)?,
        specs: serde_json::from_str(&specs).unwrap_or_default(),
        template_id: r.get(10)?,
        model_token: r.get(11)?,
        priority: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
        room: r.get(15)?,
        archived: r.get::<_, i64>(16)? != 0,
    })
}

pub fn get_item(conn: &Connection, id: &str) -> Result<Option<ComprasItem>, String> {
    conn.query_row(&format!("SELECT {ITEM_COLS} FROM items WHERE id=?1"), params![id], row_item).optional().map_err(dberr)
}

fn insert_item_row(conn: &Connection, i: &ComprasItem) -> Result<(), String> {
    let specs = serde_json::to_string(&i.specs).map_err(|e| e.to_string())?;
    conn.execute(
        &format!("INSERT INTO items({ITEM_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)"),
        params![
            i.id, i.category, i.name, i.qty, i.budget_unit_cents, i.target_cents, i.notes, i.bought as i64,
            i.image_path, specs, i.template_id, i.model_token, i.priority, i.created_at, i.updated_at, i.room, i.archived as i64
        ],
    )
    .map_err(dberr)?;
    Ok(())
}

fn validate_item(i: &mut ComprasItem) -> Result<(), String> {
    i.name = i.name.trim().to_string();
    i.category = i.category.trim().to_string();
    if i.name.is_empty() {
        return Err("Informe o nome do item.".to_string());
    }
    if i.category.is_empty() {
        return Err("Informe a categoria do item.".to_string());
    }
    if i.qty < 0 {
        return Err("A quantidade não pode ser negativa.".to_string());
    }
    for (label, v) in [("orçamento", i.budget_unit_cents), ("preço-alvo", i.target_cents)] {
        if let Some(c) = v {
            if c < 0 {
                return Err(format!("O valor de {label} não pode ser negativo."));
            }
        }
    }
    i.model_token = i.model_token.take().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    i.template_id = i.template_id.take().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    i.priority = i.priority.clamp(0, 2);
    i.room = i.room.take().map(|r| r.trim().to_string()).filter(|r| !r.is_empty());
    Ok(())
}

pub fn upsert_item(conn: &Connection, mut item: ComprasItem, now: &str) -> Result<ComprasItem, String> {
    validate_item(&mut item)?;
    if item.id.trim().is_empty() {
        item.id = uuid::Uuid::new_v4().to_string();
        item.created_at = now.to_string();
        item.updated_at = now.to_string();
        item.bought = false;
        item.archived = false;
        item.image_path = None;
        if item.template_id.is_none() {
            item.template_id = templates::template_for_name(&item.name).map(|s| s.to_string());
            for (k, v) in templates::initial_specs(item.template_id.as_deref(), &item.name) {
                item.specs.entry(k).or_insert(v);
            }
        }
        let tx = conn.unchecked_transaction().map_err(dberr)?;
        insert_item_row(&tx, &item)?;
        sync_rule_target(&tx, &item.id, item.target_cents, now)?;
        tx.commit().map_err(dberr)?;
        return Ok(item);
    }
    let existing = get_item(conn, &item.id)?.ok_or_else(|| "Item não encontrado.".to_string())?;
    let specs = serde_json::to_string(&item.specs).map_err(|e| e.to_string())?;
    // `bought`, `archived` e `image_path` só mudam por comandos próprios.
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    tx.execute(
        "UPDATE items SET category=?2, name=?3, qty=?4, budget_unit_cents=?5, target_cents=?6, notes=?7, specs=?8, template_id=?9, model_token=?10, priority=?11, room=?13, updated_at=?12 WHERE id=?1",
        params![
            item.id, item.category, item.name, item.qty, item.budget_unit_cents, item.target_cents, item.notes, specs,
            item.template_id, item.model_token, item.priority, now, item.room
        ],
    )
    .map_err(dberr)?;
    if existing.target_cents != item.target_cents {
        sync_rule_target(&tx, &item.id, item.target_cents, now)?;
    }
    tx.commit().map_err(dberr)?;
    item.bought = existing.bought;
    item.archived = existing.archived;
    item.image_path = existing.image_path;
    item.created_at = existing.created_at;
    item.updated_at = now.to_string();
    Ok(item)
}

/// Apaga item (cascata: ofertas, observações, compra). A imagem é removida pelo chamador.
pub fn delete_item(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn.execute("DELETE FROM items WHERE id=?1", params![id]).map_err(dberr)?;
    if n == 0 {
        return Err("Item não encontrado.".to_string());
    }
    Ok(())
}

/// Define o caminho relativo da imagem e renova `updated_at` (o frontend usa como cache-bust).
pub fn set_item_image(conn: &Connection, item_id: &str, rel_path: &str, now: &str) -> Result<(), String> {
    let n = conn
        .execute("UPDATE items SET image_path=?2, updated_at=?3 WHERE id=?1", params![item_id, rel_path, now])
        .map_err(dberr)?;
    if n == 0 {
        return Err("Item não encontrado.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------- avisos (regras e eventos)

const RULE_COLS: &str = "item_id, enabled, target_cents, notify_new_low, snooze_until, last_alert_cents, last_alert_at, updated_at";

fn row_rule(r: &Row) -> rusqlite::Result<AlertRule> {
    Ok(AlertRule {
        item_id: r.get(0)?,
        enabled: r.get::<_, i64>(1)? != 0,
        target_cents: r.get(2)?,
        notify_new_low: r.get::<_, i64>(3)? != 0,
        snooze_until: r.get(4)?,
        last_alert_cents: r.get(5)?,
        last_alert_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn get_rule(conn: &Connection, item_id: &str) -> Result<Option<AlertRule>, String> {
    conn.query_row(&format!("SELECT {RULE_COLS} FROM alert_rules WHERE item_id=?1"), params![item_id], row_rule)
        .optional()
        .map_err(dberr)
}

fn write_rule(conn: &Connection, r: &AlertRule) -> Result<(), String> {
    conn.execute(
        &format!(
            "INSERT INTO alert_rules({RULE_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(item_id) DO UPDATE SET enabled=excluded.enabled, target_cents=excluded.target_cents,
               notify_new_low=excluded.notify_new_low, snooze_until=excluded.snooze_until,
               last_alert_cents=excluded.last_alert_cents, last_alert_at=excluded.last_alert_at, updated_at=excluded.updated_at"
        ),
        params![
            r.item_id, r.enabled as i64, r.target_cents, r.notify_new_low as i64, r.snooze_until, r.last_alert_cents,
            r.last_alert_at, r.updated_at
        ],
    )
    .map_err(dberr)?;
    Ok(())
}

/// Item editado com novo alvo (ou criado com alvo): espelha na regra. Mudar o alvo reativa o aviso e
/// zera o "já avisado". Sem alvo, a regra continua (pode valer só "novo menor preço").
fn sync_rule_target(conn: &Connection, item_id: &str, target: Option<i64>, now: &str) -> Result<(), String> {
    match get_rule(conn, item_id)? {
        None => {
            if target.is_some() {
                write_rule(conn, &AlertRule { item_id: item_id.to_string(), target_cents: target, updated_at: now.to_string(), ..Default::default() })?;
            }
        }
        Some(mut r) => {
            if r.target_cents != target {
                r.target_cents = target;
                r.last_alert_cents = None;
                r.last_alert_at = None;
                if target.is_some() {
                    r.enabled = true;
                }
                r.updated_at = now.to_string();
                write_rule(conn, &r)?;
            }
        }
    }
    Ok(())
}

fn apply_rule_edit_core(conn: &Connection, incoming: AlertRule, now: &str) -> Result<(AlertRule, bool), String> {
    if get_item(conn, &incoming.item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    if incoming.target_cents.map(|c| c < 0).unwrap_or(false) {
        return Err("O valor do aviso não pode ser negativo.".to_string());
    }
    let existing = get_rule(conn, &incoming.item_id)?;
    let target_changed = match &existing {
        Some(r) => r.target_cents != incoming.target_cents,
        None => incoming.target_cents.is_some(),
    };
    let was_enabled = existing.as_ref().map(|r| r.enabled).unwrap_or(false);
    let mut rule = existing.unwrap_or_default();
    rule.item_id = incoming.item_id.clone();
    rule.enabled = incoming.enabled;
    rule.target_cents = incoming.target_cents;
    rule.notify_new_low = incoming.notify_new_low;
    rule.updated_at = now.to_string();
    if target_changed {
        rule.last_alert_cents = None;
        rule.last_alert_at = None;
    }
    write_rule(conn, &rule)?;
    // `items.target_cents` é a fonte da verdade do alvo: mantém igual à regra
    conn.execute("UPDATE items SET target_cents=?2 WHERE id=?1", params![rule.item_id, rule.target_cents]).map_err(dberr)?;
    let needs_eval = rule.enabled && rule.target_cents.is_some() && (target_changed || !was_enabled);
    Ok((rule, needs_eval))
}

/// Cria/atualiza a regra vinda da UI (snooze e "já avisado" ficam com o backend). O booleano indica se vale
/// avaliar o preço atual contra o novo alvo.
pub fn apply_rule_edit(conn: &Connection, incoming: AlertRule, now: &str) -> Result<(AlertRule, bool), String> {
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let out = apply_rule_edit_core(&tx, incoming, now)?;
    tx.commit().map_err(dberr)?;
    Ok(out)
}

/// Define o alvo de vários itens numa transação (mantém `notify_new_low` e liga o aviso). Itens inexistentes são pulados.
/// Alvos para a ação em lote: só itens pedidos, não comprados, não arquivados e com preço atual.
pub fn bulk_targets(views: &[ItemView], item_ids: &[String], pct_below_current: f64) -> Vec<(String, i64)> {
    let wanted: std::collections::HashSet<&str> = item_ids.iter().map(|s| s.as_str()).collect();
    views
        .iter()
        .filter(|v| wanted.contains(v.item.id.as_str()) && !v.item.bought && !v.item.archived)
        .filter_map(|v| {
            let cur = v.best.as_ref()?.final_cents?;
            Some((v.item.id.clone(), ((cur as f64) * (1.0 - pct_below_current / 100.0)).round() as i64))
        })
        .collect()
}

pub fn bulk_set_targets(conn: &Connection, targets: &[(String, i64)], now: &str) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let mut n = 0;
    for (id, cents) in targets {
        if get_item(&tx, id)?.is_none() {
            continue;
        }
        let mut rule = get_rule(&tx, id)?.unwrap_or_else(|| AlertRule { item_id: id.clone(), ..Default::default() });
        rule.enabled = true;
        rule.target_cents = Some((*cents).max(0));
        apply_rule_edit_core(&tx, rule, now)?;
        n += 1;
    }
    tx.commit().map_err(dberr)?;
    Ok(n)
}

pub fn set_alert_state(conn: &Connection, item_id: &str, cents: Option<i64>, at: Option<&str>) -> Result<(), String> {
    conn.execute("UPDATE alert_rules SET last_alert_cents=?2, last_alert_at=?3 WHERE item_id=?1", params![item_id, cents, at]).map_err(dberr)?;
    Ok(())
}

/// Preço voltou acima do alvo: limpa só o "último preço avisado". `last_alert_at` fica, para o cooldown
/// continuar valendo se o preço oscilar em torno do alvo (anti-spam).
pub fn rearm_alert(conn: &Connection, item_id: &str) -> Result<(), String> {
    conn.execute("UPDATE alert_rules SET last_alert_cents=NULL WHERE item_id=?1", params![item_id]).map_err(dberr)?;
    Ok(())
}

pub fn set_snooze(conn: &Connection, item_id: &str, until: Option<&str>, now: &str) -> Result<AlertRule, String> {
    if let Some(u) = until {
        if DateTime::parse_from_rfc3339(u).is_err() {
            return Err("Data inválida para silenciar o aviso.".to_string());
        }
    }
    let n = conn
        .execute("UPDATE alert_rules SET snooze_until=?2, updated_at=?3 WHERE item_id=?1", params![item_id, until, now])
        .map_err(dberr)?;
    if n == 0 {
        return Err("Este item não tem aviso configurado.".to_string());
    }
    get_rule(conn, item_id)?.ok_or_else(|| "Este item não tem aviso configurado.".to_string())
}

const EVENT_COLS: &str = "e.id, e.item_id, e.offer_id, e.kind, e.price_cents, e.prev_cents, e.reason, e.created_at, e.pending, e.seen, e.delivered_desktop, e.delivered_discord, i.name, i.bought";

fn row_event(r: &Row) -> rusqlite::Result<(AlertEvent, bool)> {
    let kind: String = r.get(3)?;
    let kind = AlertKind::parse(&kind).unwrap_or(AlertKind::Target);
    let name: String = r.get(12)?;
    let ev = AlertEvent {
        id: r.get(0)?,
        item_id: r.get(1)?,
        offer_id: r.get(2)?,
        kind,
        price_cents: r.get(4)?,
        prev_cents: r.get(5)?,
        reason: r.get(6)?,
        created_at: r.get(7)?,
        pending: r.get::<_, i64>(8)? != 0,
        seen: r.get::<_, i64>(9)? != 0,
        delivered_desktop: r.get::<_, i64>(10)? != 0,
        delivered_discord: r.get::<_, i64>(11)? != 0,
        title: super::alerts::title_for(kind, &name),
        item_name: name,
    };
    Ok((ev, r.get::<_, i64>(13)? != 0))
}

pub fn insert_event(conn: &Connection, e: &AlertEvent) -> Result<(), String> {
    conn.execute(
        "INSERT INTO alert_events(id, item_id, offer_id, kind, price_cents, prev_cents, reason, created_at, pending, seen, delivered_desktop, delivered_discord)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            e.id, e.item_id, e.offer_id, e.kind.as_str(), e.price_cents, e.prev_cents, e.reason, e.created_at, e.pending as i64,
            e.seen as i64, e.delivered_desktop as i64, e.delivered_discord as i64
        ],
    )
    .map_err(dberr)?;
    Ok(())
}

/// Mais recentes primeiro. `limit` fica entre 1 e 500.
pub fn list_events(conn: &Connection, limit: i64, unseen_only: bool) -> Result<Vec<AlertEvent>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {EVENT_COLS} FROM alert_events e JOIN items i ON i.id=e.item_id
             WHERE i.archived=0 AND (?1=0 OR e.seen=0) ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?2"
        ))
        .map_err(dberr)?;
    let rows = stmt.query_map(params![unseen_only as i64, limit.clamp(1, 500)], row_event).map_err(dberr)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(dberr)?.0);
    }
    Ok(out)
}

/// `None` = todos. Retorna quantos foram marcados.
pub fn mark_events_seen(conn: &Connection, ids: Option<&[String]>) -> Result<usize, String> {
    match ids {
        None => conn.execute("UPDATE alert_events SET seen=1 WHERE seen=0", []).map_err(dberr),
        Some(ids) => {
            let tx = conn.unchecked_transaction().map_err(dberr)?;
            let mut n = 0;
            for id in ids {
                n += tx.execute("UPDATE alert_events SET seen=1 WHERE id=?1 AND seen=0", params![id]).map_err(dberr)?;
            }
            tx.commit().map_err(dberr)?;
            Ok(n)
        }
    }
}

/// `channel`: "desktop" | "discord".
pub fn mark_delivered(conn: &Connection, ids: &[String], channel: &str) -> Result<(), String> {
    let col = match channel {
        "desktop" => "delivered_desktop",
        "discord" => "delivered_discord",
        _ => return Ok(()),
    };
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    for id in ids {
        tx.execute(&format!("UPDATE alert_events SET {col}=1 WHERE id=?1"), params![id]).map_err(dberr)?;
    }
    tx.commit().map_err(dberr)
}

/// Eventos retidos pelo horário silencioso. Zera `pending` de todos (cada um sai uma única vez);
/// itens já comprados nesse meio-tempo não voltam.
pub fn take_pending_events(conn: &Connection) -> Result<Vec<AlertEvent>, String> {
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let rows: Vec<(AlertEvent, bool)> = {
        let mut stmt = tx
            .prepare(&format!(
                "SELECT {EVENT_COLS} FROM alert_events e JOIN items i ON i.id=e.item_id WHERE e.pending=1 AND i.archived=0 ORDER BY e.created_at, e.rowid"
            ))
            .map_err(dberr)?;
        let rs = stmt.query_map([], row_event).map_err(dberr)?;
        rs.collect::<Result<Vec<_>, _>>().map_err(dberr)?
    };
    tx.execute("UPDATE alert_events SET pending=0 WHERE pending=1", []).map_err(dberr)?;
    tx.commit().map_err(dberr)?;
    Ok(rows
        .into_iter()
        .filter(|(_, bought)| !*bought)
        .map(|(mut e, _)| {
            e.pending = false;
            e
        })
        .collect())
}

pub fn has_pending_events(conn: &Connection) -> bool {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM alert_events WHERE pending=1)", [], |r| r.get::<_, i64>(0)).map(|v| v != 0).unwrap_or(false)
}

// ---------------------------------------------------------------- ofertas

const OFFER_COLS: &str = "id, item_id, store, url, title, sku, adapter, shipping_cents, shipping_note, pix_discount_pct, status, fail_count, last_error, last_checked_at, next_poll_at, created_at";

fn row_offer(r: &Row) -> rusqlite::Result<ComprasOffer> {
    let adapter: String = r.get(6)?;
    let status: String = r.get(10)?;
    Ok(ComprasOffer {
        id: r.get(0)?,
        item_id: r.get(1)?,
        store: r.get(2)?,
        url: r.get(3)?,
        title: r.get(4)?,
        sku: r.get(5)?,
        adapter: OfferAdapter::parse(&adapter).unwrap_or(OfferAdapter::Generic),
        shipping_cents: r.get(7)?,
        shipping_note: r.get(8)?,
        pix_discount_pct: r.get(9)?,
        status: OfferStatus::parse(&status).unwrap_or(OfferStatus::Pending),
        fail_count: r.get(11)?,
        last_error: r.get(12)?,
        last_checked_at: r.get(13)?,
        next_poll_at: r.get(14)?,
        created_at: r.get(15)?,
    })
}

pub fn get_offer(conn: &Connection, id: &str) -> Result<Option<ComprasOffer>, String> {
    conn.query_row(&format!("SELECT {OFFER_COLS} FROM offers WHERE id=?1"), params![id], row_offer).optional().map_err(dberr)
}

pub fn upsert_offer(conn: &Connection, mut o: ComprasOffer, now: &str) -> Result<ComprasOffer, String> {
    if get_item(conn, &o.item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    o.url = o.url.take().map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    if let Some(u) = &o.url {
        check_http_url(u)?;
    }
    let manual = o.url.is_none() || o.adapter == OfferAdapter::Manual;
    if manual {
        o.adapter = OfferAdapter::Manual;
    } else if let Some(u) = &o.url {
        o.adapter = extract::detect_adapter(u);
    }
    o.store = o.store.trim().to_string();
    if o.store.is_empty() {
        o.store = o.url.as_deref().map(extract::store_name).unwrap_or_default();
    }
    if o.store.is_empty() {
        return Err("Informe a loja.".to_string());
    }
    if o.shipping_cents.map(|c| c < 0).unwrap_or(false) {
        return Err("O frete não pode ser negativo.".to_string());
    }
    if o.pix_discount_pct.map(|p| !p.is_finite() || !(0.0..100.0).contains(&p)).unwrap_or(false) {
        return Err("O desconto Pix deve estar entre 0 e 100.".to_string());
    }
    o.shipping_note = o.shipping_note.take().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let default_active = if manual { OfferStatus::Manual } else { OfferStatus::Pending };

    if o.id.trim().is_empty() {
        o.id = uuid::Uuid::new_v4().to_string();
        o.status = if o.status == OfferStatus::Paused { OfferStatus::Paused } else { default_active };
        o.fail_count = 0;
        o.last_error = None;
        o.last_checked_at = None;
        o.next_poll_at = if manual { None } else { Some(now.to_string()) };
        o.created_at = now.to_string();
        insert_offer_row(conn, &o)?;
        return Ok(o);
    }

    let existing = get_offer(conn, &o.id)?.ok_or_else(|| "Oferta não encontrada.".to_string())?;
    let url_changed = existing.url != o.url;
    let incoming_status = o.status;
    let mut reset_poll = false;
    o.status = if incoming_status == OfferStatus::Paused {
        OfferStatus::Paused
    } else if url_changed && !manual {
        reset_poll = true;
        OfferStatus::Pending
    } else if existing.status == OfferStatus::Paused {
        reset_poll = !manual;
        default_active
    } else if manual {
        OfferStatus::Manual
    } else if existing.status == OfferStatus::Manual {
        reset_poll = true;
        OfferStatus::Pending
    } else {
        existing.status
    };
    if reset_poll {
        o.fail_count = 0;
        o.last_error = None;
        o.next_poll_at = Some(now.to_string());
    } else {
        o.fail_count = existing.fail_count;
        o.last_error = existing.last_error.clone();
        o.next_poll_at = if manual { None } else { existing.next_poll_at.clone() };
    }
    o.last_checked_at = existing.last_checked_at.clone();
    o.created_at = existing.created_at.clone();
    o.title = o.title.take().or(existing.title.clone());
    o.sku = o.sku.take().or(existing.sku.clone());
    conn.execute(
        "UPDATE offers SET store=?2, url=?3, title=?4, sku=?5, adapter=?6, shipping_cents=?7, shipping_note=?8, pix_discount_pct=?9, status=?10, fail_count=?11, last_error=?12, next_poll_at=?13 WHERE id=?1",
        params![
            o.id, o.store, o.url, o.title, o.sku, o.adapter.as_str(), o.shipping_cents, o.shipping_note, o.pix_discount_pct,
            o.status.as_str(), o.fail_count, o.last_error, o.next_poll_at
        ],
    )
    .map_err(dberr)?;
    Ok(o)
}

fn insert_offer_row(conn: &Connection, o: &ComprasOffer) -> Result<(), String> {
    conn.execute(
        &format!("INSERT INTO offers({OFFER_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)"),
        params![
            o.id, o.item_id, o.store, o.url, o.title, o.sku, o.adapter.as_str(), o.shipping_cents, o.shipping_note,
            o.pix_discount_pct, o.status.as_str(), o.fail_count, o.last_error, o.last_checked_at, o.next_poll_at, o.created_at
        ],
    )
    .map_err(dberr)?;
    Ok(())
}

pub fn delete_offer(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn.execute("DELETE FROM offers WHERE id=?1", params![id]).map_err(dberr)?;
    if n == 0 {
        return Err("Oferta não encontrada.".to_string());
    }
    Ok(())
}

pub fn offer_item_id(conn: &Connection, offer_id: &str) -> Option<String> {
    conn.query_row("SELECT item_id FROM offers WHERE id=?1", params![offer_id], |r| r.get(0)).optional().ok().flatten()
}

// ---------------------------------------------------------------- observações

const OBS_COLS: &str = "id, offer_id, list_cents, cash_cents, installments_text, in_stock, source, confirmed, first_seen_at, last_seen_at, error";

fn row_obs(r: &Row) -> rusqlite::Result<ComprasObservation> {
    let source: String = r.get(6)?;
    Ok(ComprasObservation {
        id: r.get(0)?,
        offer_id: r.get(1)?,
        list_cents: r.get(2)?,
        cash_cents: r.get(3)?,
        installments_text: r.get(4)?,
        in_stock: r.get::<_, Option<i64>>(5)?.map(|v| v != 0),
        source: ObsSource::parse(&source).unwrap_or(ObsSource::Auto),
        confirmed: r.get::<_, i64>(7)? != 0,
        first_seen_at: r.get(8)?,
        last_seen_at: r.get(9)?,
        error: r.get(10)?,
    })
}

fn latest_obs(conn: &Connection, offer_id: &str, confirmed_only: bool) -> Result<Option<ComprasObservation>, String> {
    let filter = if confirmed_only { "AND confirmed=1" } else { "" };
    conn.query_row(
        &format!("SELECT {OBS_COLS} FROM observations WHERE offer_id=?1 {filter} ORDER BY first_seen_at DESC, rowid DESC LIMIT 1"),
        params![offer_id],
        row_obs,
    )
    .optional()
    .map_err(dberr)
}

/// Amostra de preço vinda de poll ou de entrada manual.
#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    pub list_cents: Option<i64>,
    pub cash_cents: Option<i64>,
    pub installments_text: Option<String>,
    pub in_stock: Option<bool>,
}

fn same_values(o: &ComprasObservation, s: &Sample) -> bool {
    o.list_cents == s.list_cents && o.cash_cents == s.cash_cents && o.in_stock == s.in_stock
}

fn insert_obs(conn: &Connection, offer_id: &str, s: &Sample, source: ObsSource, confirmed: bool, now: &str) -> Result<ComprasObservation, String> {
    let obs = ComprasObservation {
        id: uuid::Uuid::new_v4().to_string(),
        offer_id: offer_id.to_string(),
        list_cents: s.list_cents,
        cash_cents: s.cash_cents,
        installments_text: s.installments_text.clone(),
        in_stock: s.in_stock,
        source,
        confirmed,
        first_seen_at: now.to_string(),
        last_seen_at: now.to_string(),
        error: None,
    };
    conn.execute(
        &format!("INSERT INTO observations({OBS_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"),
        params![
            obs.id, obs.offer_id, obs.list_cents, obs.cash_cents, obs.installments_text, obs.in_stock.map(|b| b as i64),
            obs.source.as_str(), obs.confirmed as i64, obs.first_seen_at, obs.last_seen_at, obs.error
        ],
    )
    .map_err(dberr)?;
    Ok(obs)
}

fn extend_obs(conn: &Connection, id: &str, s: &Sample, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE observations SET last_seen_at=?2, installments_text=COALESCE(?3, installments_text) WHERE id=?1",
        params![id, now, s.installments_text],
    )
    .map_err(dberr)?;
    Ok(())
}

/// Grava uma observação automática com run-length e guardas.
/// - variante suspeita: nunca confirmada automaticamente;
/// - salto > 40% vs último confirmado: não confirmada; o próximo poll dentro de ±2% a confirma.
pub fn record_auto_observation(conn: &Connection, offer_id: &str, s: &Sample, variant_suspect: bool, now: &str) -> Result<RecordOutcome, String> {
    let latest = latest_obs(conn, offer_id, false)?;
    let confirmed = latest_obs(conn, offer_id, true)?;

    if variant_suspect {
        if let Some(l) = &latest {
            if !l.confirmed && same_values(l, s) {
                extend_obs(conn, &l.id, s, now)?;
                return Ok(RecordOutcome::Extended);
            }
        }
        insert_obs(conn, offer_id, s, ObsSource::Auto, false, now)?;
        return Ok(RecordOutcome::Unconfirmed);
    }

    let new_price = stats::guard_price(s.list_cents, s.cash_cents);
    let suspicious = match (&confirmed, new_price) {
        (Some(c), Some(np)) => stats::guard_price(c.list_cents, c.cash_cents).map(|bp| stats::is_big_jump(bp, np)).unwrap_or(false),
        _ => false,
    };

    if suspicious {
        if let (Some(l), Some(np)) = (&latest, new_price) {
            let l_price = stats::guard_price(l.list_cents, l.cash_cents);
            if !l.confirmed && l.source == ObsSource::Auto && l_price.map(|lp| stats::within_confirm_band(lp, np)).unwrap_or(false) {
                conn.execute(
                    "UPDATE observations SET confirmed=1, list_cents=?2, cash_cents=?3, in_stock=?4, installments_text=COALESCE(?5, installments_text), last_seen_at=?6 WHERE id=?1",
                    params![l.id, s.list_cents, s.cash_cents, s.in_stock.map(|b| b as i64), s.installments_text, now],
                )
                .map_err(dberr)?;
                return Ok(RecordOutcome::Confirmed);
            }
        }
        insert_obs(conn, offer_id, s, ObsSource::Auto, false, now)?;
        return Ok(RecordOutcome::Unconfirmed);
    }

    if let Some(l) = &latest {
        if l.confirmed && same_values(l, s) {
            extend_obs(conn, &l.id, s, now)?;
            return Ok(RecordOutcome::Extended);
        }
    }
    insert_obs(conn, offer_id, s, ObsSource::Auto, true, now)?;
    Ok(RecordOutcome::Inserted)
}

/// Preço digitado: sempre confirmado; estende a última observação se for idêntica.
pub fn add_manual_price(conn: &Connection, offer_id: &str, list: Option<i64>, cash: Option<i64>, in_stock: Option<bool>, now: &str) -> Result<ComprasObservation, String> {
    if get_offer(conn, offer_id)?.is_none() {
        return Err("Oferta não encontrada.".to_string());
    }
    if list.map(|c| c < 0).unwrap_or(false) || cash.map(|c| c < 0).unwrap_or(false) {
        return Err("O preço não pode ser negativo.".to_string());
    }
    if list.is_none() && cash.is_none() && in_stock != Some(false) {
        return Err("Informe o preço (lista ou à vista) ou marque como sem estoque.".to_string());
    }
    let sample = Sample { list_cents: list, cash_cents: cash, installments_text: None, in_stock };
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let latest = latest_obs(&tx, offer_id, false)?;
    let obs = match latest {
        Some(l) if l.confirmed && l.source == ObsSource::Manual && same_values(&l, &sample) => {
            extend_obs(&tx, &l.id, &sample, now)?;
            latest_obs(&tx, offer_id, false)?.ok_or_else(|| "Observação não encontrada.".to_string())?
        }
        _ => insert_obs(&tx, offer_id, &sample, ObsSource::Manual, true, now)?,
    };
    tx.execute("UPDATE offers SET last_checked_at=?2 WHERE id=?1", params![offer_id, now]).map_err(dberr)?;
    tx.commit().map_err(dberr)?;
    Ok(obs)
}

// ---------------------------------------------------------------- poll

pub struct PollContext {
    pub offer: ComprasOffer,
    pub model_token: Option<String>,
    pub settings: ComprasSettings,
}

pub fn poll_context(conn: &Connection, offer_id: &str) -> Result<Option<PollContext>, String> {
    let Some(offer) = get_offer(conn, offer_id)? else {
        return Ok(None);
    };
    let model_token = get_item(conn, &offer.item_id)?.and_then(|i| i.model_token);
    Ok(Some(PollContext { offer, model_token, settings: load_settings(conn) }))
}

/// Ofertas vencidas (id, url), mais antigas primeiro.
pub fn due_offers(conn: &Connection, now: &str) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, url FROM offers
             WHERE adapter != 'manual' AND url IS NOT NULL AND status NOT IN ('paused','manual')
               AND item_id NOT IN (SELECT id FROM items WHERE archived=1)
               AND (next_poll_at IS NULL OR next_poll_at <= ?1)
             ORDER BY COALESCE(next_poll_at, '') LIMIT 500",
        )
        .map_err(dberr)?;
    let rows = stmt.query_map(params![now], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(dberr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(dberr)
}

/// Marca ofertas como vencidas agora. Ambos None = todas. Retorna quantas.
pub fn mark_due(conn: &Connection, item_id: Option<&str>, offer_id: Option<&str>, now: &str) -> Result<usize, String> {
    conn.execute(
        "UPDATE offers SET next_poll_at=?1
         WHERE adapter != 'manual' AND url IS NOT NULL AND status != 'paused'
           AND item_id NOT IN (SELECT id FROM items WHERE archived=1)
           AND (?2 IS NULL OR id=?2) AND (?3 IS NULL OR item_id=?3)",
        params![now, offer_id, item_id],
    )
    .map_err(dberr)
}

/// Aplica o resultado de um poll (em transação). Ignora ofertas apagadas/pausadas durante a consulta.
/// Marca para consulta imediata (e zera falhas) as ofertas automáticas de uma loja.
pub fn mark_store_due(conn: &Connection, store: &str, now: &str) -> Result<usize, String> {
    conn.execute(
        "UPDATE offers SET next_poll_at = ?2, fail_count = 0 WHERE store = ?1 AND url IS NOT NULL AND adapter != 'manual' AND status != 'paused'
         AND item_id NOT IN (SELECT id FROM items WHERE archived=1)",
        params![store, now],
    )
    .map_err(dberr)
}

/// Grava o resultado da pré-visualização como primeira consulta de uma oferta recém-criada.
/// Passa pelo mesmo caminho do ticker (guarda de variante, run-length, próximo agendamento).
pub fn seed_offer(conn: &Connection, offer_id: &str, seed: Extracted, now: DateTime<Utc>, rand01: f64) -> Result<(), String> {
    if seed.blocked || (seed.list_cents.is_none() && seed.cash_cents.is_none()) {
        return Ok(());
    }
    let Some(ctx) = poll_context(conn, offer_id)? else {
        return Ok(());
    };
    let interval = scheduler::interval_minutes(&ctx.settings, ctx.offer.adapter);
    apply_poll_outcome(conn, offer_id, ctx.model_token.as_deref(), PollOutcome::Success(seed), interval, now, rand01)?;
    Ok(())
}

pub fn apply_poll_outcome(
    conn: &Connection,
    offer_id: &str,
    model_token: Option<&str>,
    outcome: PollOutcome,
    interval_minutes: i64,
    now: DateTime<Utc>,
    rand01: f64,
) -> Result<Option<OfferStatus>, String> {
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let Some(offer) = get_offer(&tx, offer_id)? else {
        return Ok(None);
    };
    if offer.status == OfferStatus::Paused || offer.adapter == OfferAdapter::Manual {
        return Ok(None);
    }
    let now_s = ts(now);
    let new_status;
    match outcome {
        PollOutcome::Success(ex) => {
            let suspect_variant = !variant_matches(model_token, ex.title.as_deref());
            let sample = Sample {
                list_cents: ex.list_cents,
                cash_cents: ex.cash_cents,
                installments_text: ex.installments_text.clone(),
                in_stock: ex.in_stock,
            };
            let rec = record_auto_observation(&tx, offer_id, &sample, suspect_variant, &now_s)?;
            let (status, error) = if suspect_variant {
                (
                    OfferStatus::Suspect,
                    Some(format!("O título da loja não contém o modelo \"{}\"; confira se é o mesmo produto.", model_token.unwrap_or(""))),
                )
            } else if rec == RecordOutcome::Unconfirmed {
                (OfferStatus::Suspect, Some("O preço mudou mais de 40%; aguardando confirmação na próxima consulta.".to_string()))
            } else {
                (OfferStatus::Ok, None)
            };
            let next = scheduler::next_poll_at(now, interval_minutes, 0, rand01);
            tx.execute(
                "UPDATE offers SET status=?2, fail_count=0, last_error=?3, last_checked_at=?4, next_poll_at=?5,
                   title=COALESCE(?6, title), sku=COALESCE(?7, sku) WHERE id=?1",
                params![offer_id, status.as_str(), error, now_s, ts(next), ex.title, ex.sku],
            )
            .map_err(dberr)?;
            new_status = status;
        }
        PollOutcome::Failure { kind, message } => {
            let fails = offer.fail_count + 1;
            let status = match kind {
                FailKind::Blocked => OfferStatus::Blocked,
                FailKind::Gone => OfferStatus::Broken,
                FailKind::Transient => {
                    if fails >= 3 {
                        OfferStatus::Broken
                    } else {
                        offer.status
                    }
                }
            };
            let next = scheduler::next_poll_at(now, interval_minutes, fails, rand01);
            tx.execute(
                "UPDATE offers SET status=?2, fail_count=?3, last_error=?4, last_checked_at=?5, next_poll_at=?6 WHERE id=?1",
                params![offer_id, status.as_str(), fails, message, now_s, ts(next)],
            )
            .map_err(dberr)?;
            new_status = status;
        }
    }
    tx.commit().map_err(dberr)?;
    Ok(Some(new_status))
}

// ---------------------------------------------------------------- compras (purchase)

fn write_purchase(conn: &Connection, p: &ComprasPurchase, now: &str) -> Result<(), String> {
    let purchased_at = if p.purchased_at.trim().is_empty() { now.to_string() } else { p.purchased_at.clone() };
    conn.execute(
        "INSERT INTO purchases(item_id, paid_unit_cents, shipping_cents, store, purchased_at, notes) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(item_id) DO UPDATE SET paid_unit_cents=excluded.paid_unit_cents, shipping_cents=excluded.shipping_cents,
           store=excluded.store, purchased_at=excluded.purchased_at, notes=excluded.notes",
        params![p.item_id, p.paid_unit_cents, p.shipping_cents, p.store, purchased_at, p.notes],
    )
    .map_err(dberr)?;
    conn.execute("UPDATE items SET bought=1, updated_at=?2 WHERE id=?1", params![p.item_id, now]).map_err(dberr)?;
    // pausa o monitoramento (ofertas manuais continuam "manual")
    conn.execute("UPDATE offers SET status='paused' WHERE item_id=?1 AND adapter != 'manual'", params![p.item_id]).map_err(dberr)?;
    Ok(())
}

pub fn mark_bought(conn: &Connection, p: &ComprasPurchase, now: &str) -> Result<(), String> {
    if p.paid_unit_cents < 0 || p.shipping_cents < 0 {
        return Err("Os valores pagos não podem ser negativos.".to_string());
    }
    if get_item(conn, &p.item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    write_purchase(&tx, p, now)?;
    tx.commit().map_err(dberr)
}

pub fn unmark_bought(conn: &Connection, item_id: &str, now: &str) -> Result<(), String> {
    if get_item(conn, item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    tx.execute("DELETE FROM purchases WHERE item_id=?1", params![item_id]).map_err(dberr)?;
    tx.execute("UPDATE items SET bought=0, updated_at=?2 WHERE id=?1", params![item_id, now]).map_err(dberr)?;
    // retoma o monitoramento das ofertas pausadas
    tx.execute("UPDATE offers SET status='pending', next_poll_at=?2 WHERE item_id=?1 AND status='paused' AND adapter != 'manual'", params![item_id, now])
        .map_err(dberr)?;
    tx.commit().map_err(dberr)
}

fn row_purchase(r: &Row) -> rusqlite::Result<ComprasPurchase> {
    Ok(ComprasPurchase {
        item_id: r.get(0)?,
        paid_unit_cents: r.get(1)?,
        shipping_cents: r.get(2)?,
        store: r.get(3)?,
        purchased_at: r.get(4)?,
        notes: r.get(5)?,
    })
}

// ---------------------------------------------------------------- views

fn store_pix_pct(settings: &ComprasSettings, store: &str) -> Option<f64> {
    settings
        .pix_discount_by_store
        .get(store)
        .or_else(|| settings.pix_discount_by_store.iter().find(|(k, _)| k.eq_ignore_ascii_case(store)).map(|(_, v)| v))
        .copied()
}

/// Base de preço de uma observação: à vista efetivo, origem e final, conforme `usePix`/`includeShipping`.
fn price_basis(
    ob: &ComprasObservation,
    offer: &ComprasOffer,
    settings: &ComprasSettings,
) -> (Option<i64>, Option<CashSource>, Option<i64>) {
    let (cash, src) = stats::effective_cash_basis(
        ob.list_cents,
        ob.cash_cents,
        offer.pix_discount_pct,
        store_pix_pct(settings, &offer.store),
        settings.use_pix,
    );
    let fin = stats::final_price_basis(cash, offer.shipping_cents, settings.include_shipping);
    (cash, src, fin)
}

pub fn offer_view(offer: ComprasOffer, latest: Option<ComprasObservation>, settings: &ComprasSettings) -> OfferView {
    let (cash, src, final_cents) = match &latest {
        Some(l) => price_basis(l, &offer, settings),
        None => (None, None, None),
    };
    let shipping_known = offer.shipping_cents.is_some();
    OfferView { offer, latest, effective_cash_cents: cash, cash_source: src, final_cents, shipping_known }
}

fn is_candidate(v: &OfferView) -> bool {
    v.offer.status != OfferStatus::Paused
        && v.final_cents.is_some()
        && v.latest.as_ref().map(|l| l.in_stock != Some(false)).unwrap_or(false)
}

fn best_of(offers: &[OfferView]) -> Option<OfferView> {
    offers.iter().filter(|v| is_candidate(v)).min_by_key(|v| v.final_cents.unwrap_or(i64::MAX)).cloned()
}

/// Faixas de preço (confirmadas, com estoque ou desconhecido) de todas as ofertas do item.
fn spans_for(offers: &[ComprasOffer], obs: &HashMap<String, Vec<ComprasObservation>>, settings: &ComprasSettings) -> Vec<PricedSpan> {
    let mut out = Vec::new();
    for o in offers {
        let Some(list) = obs.get(&o.id) else { continue };
        for ob in list {
            if !ob.confirmed || ob.in_stock == Some(false) {
                continue;
            }
            let (_, _, fin) = price_basis(ob, o, settings);
            let Some(fin) = fin else { continue };
            let (Some(first), Some(last)) = (parse_ts(&ob.first_seen_at), parse_ts(&ob.last_seen_at)) else { continue };
            out.push(PricedSpan { offer_id: o.id.clone(), final_cents: fin, first, last });
        }
    }
    out
}

pub fn load_views(
    conn: &Connection,
    only: Option<&str>,
    settings: &ComprasSettings,
    today: NaiveDate,
    tz: FixedOffset,
    compras_dir: &Path,
) -> Result<Vec<ItemView>, String> {
    let items: Vec<ComprasItem> = {
        let mut stmt = conn
            .prepare(&format!("SELECT {ITEM_COLS} FROM items WHERE (?1 IS NULL OR id=?1) ORDER BY rowid"))
            .map_err(dberr)?;
        let rows = stmt.query_map(params![only], row_item).map_err(dberr)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(dberr)?
    };
    let offers: Vec<ComprasOffer> = {
        let mut stmt = conn
            .prepare(&format!("SELECT {OFFER_COLS} FROM offers WHERE (?1 IS NULL OR item_id=?1) ORDER BY rowid"))
            .map_err(dberr)?;
        let rows = stmt.query_map(params![only], row_offer).map_err(dberr)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(dberr)?
    };
    let mut obs_by_offer: HashMap<String, Vec<ComprasObservation>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {OBS_COLS} FROM observations WHERE confirmed=1
                 AND offer_id IN (SELECT id FROM offers WHERE (?1 IS NULL OR item_id=?1))
                 ORDER BY first_seen_at, rowid"
            ))
            .map_err(dberr)?;
        let rows = stmt.query_map(params![only], row_obs).map_err(dberr)?;
        for r in rows {
            let o = r.map_err(dberr)?;
            obs_by_offer.entry(o.offer_id.clone()).or_default().push(o);
        }
    }
    let purchases: HashMap<String, ComprasPurchase> = {
        let mut stmt = conn
            .prepare("SELECT item_id, paid_unit_cents, shipping_cents, store, purchased_at, notes FROM purchases WHERE (?1 IS NULL OR item_id=?1)")
            .map_err(dberr)?;
        let rows = stmt.query_map(params![only], row_purchase).map_err(dberr)?;
        let mut m = HashMap::new();
        for r in rows {
            let p = r.map_err(dberr)?;
            m.insert(p.item_id.clone(), p);
        }
        m
    };
    let rules: HashMap<String, AlertRule> = {
        let mut stmt = conn
            .prepare(&format!("SELECT {RULE_COLS} FROM alert_rules WHERE (?1 IS NULL OR item_id=?1)"))
            .map_err(dberr)?;
        let rows = stmt.query_map(params![only], row_rule).map_err(dberr)?;
        let mut m = HashMap::new();
        for r in rows {
            let r = r.map_err(dberr)?;
            m.insert(r.item_id.clone(), r);
        }
        m
    };
    let mut offers_by_item: HashMap<String, Vec<ComprasOffer>> = HashMap::new();
    for o in offers {
        offers_by_item.entry(o.item_id.clone()).or_default().push(o);
    }

    let mut views = Vec::with_capacity(items.len());
    for item in items {
        let raw = offers_by_item.remove(&item.id).unwrap_or_default();
        let spans = spans_for(&raw, &obs_by_offer, settings);
        let offer_views: Vec<OfferView> = raw
            .into_iter()
            .map(|o| {
                let latest = obs_by_offer.get(&o.id).and_then(|v| v.last()).cloned();
                offer_view(o, latest, settings)
            })
            .collect();
        let best = best_of(&offer_views);
        let series: Vec<(NaiveDate, i64)> = stats::daily_points(&spans, tz).into_iter().map(|(d, p)| (d, p.best)).collect();
        let current_final = best.as_ref().and_then(|b| b.final_cents);
        let st = stats::compute_stats(&series, today, 90, current_final, item.target_cents);
        let span_days = stats::window_span_days(&series, today, 90);
        let verdict = stats::verdict(st.samples, span_days, current_final, st.p25_cents, st.p75_cents);
        let range = stats::price_range(&st);
        let sparkline = stats::sparkline(&series, today, stats::SPARKLINE_DAYS);
        let image_file = item
            .image_path
            .as_ref()
            .map(|rel| compras_dir.join(rel))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned());
        let purchase = purchases.get(&item.id).cloned();
        let alert = rules.get(&item.id).cloned();
        views.push(ItemView { item, image_file, offers: offer_views, best, stats: st, purchase, alert, verdict, range, sparkline });
    }
    Ok(views)
}

/// Arquiva/desarquiva. Itens arquivados ficam fora das listas padrão, do orçamento, dos avisos e da coleta.
pub fn set_archived(conn: &Connection, id: &str, archived: bool, now: &str) -> Result<(), String> {
    let n = conn
        .execute("UPDATE items SET archived=?2, updated_at=?3 WHERE id=?1", params![id, archived as i64, now])
        .map_err(dberr)?;
    if n == 0 {
        return Err("Item não encontrado.".to_string());
    }
    Ok(())
}

/// Tira os arquivados, a menos que `include_archived`.
pub fn visible_views(views: Vec<ItemView>, include_archived: bool) -> Vec<ItemView> {
    if include_archived {
        views
    } else {
        views.into_iter().filter(|v| !v.item.archived).collect()
    }
}

pub fn history(
    conn: &Connection,
    item_id: &str,
    days: Option<i64>,
    settings: &ComprasSettings,
    today: NaiveDate,
    tz: FixedOffset,
) -> Result<Vec<HistoryPoint>, String> {
    if get_item(conn, item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    let offers: Vec<ComprasOffer> = {
        let mut stmt = conn.prepare(&format!("SELECT {OFFER_COLS} FROM offers WHERE item_id=?1 ORDER BY rowid")).map_err(dberr)?;
        let rows = stmt.query_map(params![item_id], row_offer).map_err(dberr)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(dberr)?
    };
    let mut obs_by_offer: HashMap<String, Vec<ComprasObservation>> = HashMap::new();
    for o in &offers {
        let mut stmt = conn
            .prepare(&format!("SELECT {OBS_COLS} FROM observations WHERE offer_id=?1 AND confirmed=1 ORDER BY first_seen_at, rowid"))
            .map_err(dberr)?;
        let rows = stmt.query_map(params![o.id], row_obs).map_err(dberr)?;
        obs_by_offer.insert(o.id.clone(), rows.collect::<Result<Vec<_>, _>>().map_err(dberr)?);
    }
    let spans = spans_for(&offers, &obs_by_offer, settings);
    let pts = stats::daily_points(&spans, tz);
    let cutoff = days.map(|d| today - chrono::Duration::days(d.max(0)));
    let mut out = Vec::new();
    for (date, p) in pts {
        if cutoff.map(|c| date < c).unwrap_or(false) {
            continue;
        }
        let mut per_offer: BTreeMap<String, Option<i64>> = BTreeMap::new();
        for o in &offers {
            per_offer.insert(o.id.clone(), p.per_offer.get(&o.id).copied());
        }
        out.push(HistoryPoint { date: date.format("%Y-%m-%d").to_string(), best_final_cents: Some(p.best), per_offer });
    }
    Ok(out)
}

// ---------------------------------------------------------------- orçamento

pub fn budget_summary(views: &[ItemView]) -> BudgetSummary {
    let views: Vec<&ItemView> = views.iter().filter(|v| !v.item.archived).collect();
    let mut s = BudgetSummary {
        total_budget_cents: 0,
        bought_cents: 0,
        remaining_budget_cents: 0,
        remaining_at_current_cents: 0,
        priced_items: 0,
        pct_done: 0.0,
        items_total: views.len() as i64,
        items_bought: 0,
        by_category: Vec::new(),
    };
    let mut idx: HashMap<String, usize> = HashMap::new();
    for v in views {
        let qty = v.item.qty;
        let budget = qty * v.item.budget_unit_cents.unwrap_or(0);
        let pos = *idx.entry(v.item.category.clone()).or_insert_with(|| {
            s.by_category.push(CategoryBudget { category: v.item.category.clone(), budget_cents: 0, bought_cents: 0, current_cents: 0 });
            s.by_category.len() - 1
        });
        s.total_budget_cents += budget;
        s.by_category[pos].budget_cents += budget;
        if v.item.bought {
            let paid = v.purchase.as_ref().map(|p| qty * p.paid_unit_cents + p.shipping_cents).unwrap_or(0);
            s.items_bought += 1;
            s.bought_cents += paid;
            s.by_category[pos].bought_cents += paid;
            s.by_category[pos].current_cents += paid;
        } else {
            s.remaining_budget_cents += budget;
            let current = match v.best.as_ref().and_then(|b| b.final_cents) {
                Some(f) => {
                    s.priced_items += 1;
                    qty * f
                }
                None => budget,
            };
            s.remaining_at_current_cents += current;
            s.by_category[pos].current_cents += current;
        }
    }
    s.pct_done = if s.total_budget_cents > 0 { s.bought_cents as f64 / s.total_budget_cents as f64 } else { 0.0 };
    s
}

// ---------------------------------------------------------------- import

#[derive(Debug, Clone, PartialEq)]
pub struct SheetItem {
    pub bought: bool,
    pub category: String,
    pub name: String,
    pub qty: i64,
    pub budget_unit_cents: Option<i64>,
    pub notes: String,
}

fn key_of(category: &str, name: &str) -> String {
    format!("{}\u{1}{}", category.trim().to_lowercase(), name.trim().to_lowercase())
}

/// Importa as linhas da planilha numa única transação. Idempotente por (categoria, nome).
pub fn import_items(conn: &Connection, rows: &[SheetItem], now: &str, mut report: ImportReport) -> Result<ImportReport, String> {
    let tx = conn.unchecked_transaction().map_err(dberr)?;
    let mut existing: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, category, name FROM items ORDER BY rowid").map_err(dberr)?;
        let rs = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .map_err(dberr)?;
        for r in rs {
            let (id, c, n) = r.map_err(dberr)?;
            existing.entry(key_of(&c, &n)).or_default().push(id);
        }
    }
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    for row in rows {
        let key = key_of(&row.category, &row.name);
        let matched = existing.get(&key).and_then(|ids| ids.iter().find(|id| !used.contains(*id)).cloned());
        let item_id = match matched {
            Some(id) => {
                let Some(mut it) = get_item(&tx, &id)? else {
                    report.skipped += 1;
                    continue;
                };
                it.qty = row.qty;
                it.budget_unit_cents = row.budget_unit_cents;
                if !row.notes.trim().is_empty() {
                    it.notes = row.notes.clone();
                }
                if it.template_id.is_none() {
                    it.template_id = templates::template_for_name(&it.name).map(|s| s.to_string());
                }
                for (k, v) in templates::initial_specs(it.template_id.as_deref(), &it.name) {
                    it.specs.entry(k).or_insert(v);
                }
                let specs = serde_json::to_string(&it.specs).map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE items SET qty=?2, budget_unit_cents=?3, notes=?4, template_id=?5, specs=?6, updated_at=?7 WHERE id=?1",
                    params![it.id, it.qty, it.budget_unit_cents, it.notes, it.template_id, specs, now],
                )
                .map_err(dberr)?;
                report.updated += 1;
                id
            }
            None => {
                let template_id = templates::template_for_name(&row.name).map(|s| s.to_string());
                let it = ComprasItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    category: row.category.trim().to_string(),
                    name: row.name.trim().to_string(),
                    qty: row.qty,
                    budget_unit_cents: row.budget_unit_cents,
                    target_cents: None,
                    notes: row.notes.clone(),
                    bought: false,
                    image_path: None,
                    specs: templates::initial_specs(template_id.as_deref(), &row.name),
                    template_id,
                    model_token: None,
                    priority: 1,
                    created_at: now.to_string(),
                    updated_at: now.to_string(),
                    room: None,
                    archived: false,
                };
                insert_item_row(&tx, &it)?;
                report.inserted += 1;
                it.id
            }
        };
        used.insert(item_id.clone());
        if row.bought {
            let already = get_item(&tx, &item_id)?.map(|i| i.bought).unwrap_or(false);
            if !already {
                let p = ComprasPurchase {
                    item_id: item_id.clone(),
                    paid_unit_cents: row.budget_unit_cents.unwrap_or(0),
                    shipping_cents: 0,
                    store: String::new(),
                    purchased_at: now.to_string(),
                    notes: "importado da planilha".to_string(),
                };
                write_purchase(&tx, &p, now)?;
                report.bought_imported += 1;
            }
        }
    }
    tx.commit().map_err(dberr)?;
    Ok(report)
}

/// Totais atuais do banco (para o relatório de importação).
pub fn totals(conn: &Connection, dir: &Path, today: NaiveDate, tz: FixedOffset) -> Result<BudgetSummary, String> {
    let settings = load_settings(conn);
    let views = load_views(conn, None, &settings, today, tz, dir)?;
    Ok(budget_summary(&views))
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn mem() -> Connection {
        open_memory().unwrap()
    }

    const NOW: &str = "2026-11-05T12:00:00Z";

    fn new_item(conn: &Connection, name: &str, qty: i64, budget: Option<i64>) -> ComprasItem {
        upsert_item(
            conn,
            ComprasItem {
                id: String::new(),
                category: "Eletros".into(),
                name: name.into(),
                qty,
                budget_unit_cents: budget,
                target_cents: None,
                notes: String::new(),
                bought: false,
                image_path: None,
                specs: BTreeMap::new(),
                template_id: None,
                model_token: None,
                priority: 1,
                created_at: String::new(),
                updated_at: String::new(),
                room: None,
                archived: false,
            },
            NOW,
        )
        .unwrap()
    }

    fn new_offer(conn: &Connection, item_id: &str, url: Option<&str>, store: &str) -> ComprasOffer {
        upsert_offer(
            conn,
            ComprasOffer {
                id: String::new(),
                item_id: item_id.into(),
                store: store.into(),
                url: url.map(|s| s.to_string()),
                title: None,
                sku: None,
                adapter: OfferAdapter::Generic,
                shipping_cents: None,
                shipping_note: None,
                pix_discount_pct: None,
                status: OfferStatus::Pending,
                fail_count: 0,
                last_error: None,
                last_checked_at: None,
                next_poll_at: None,
                created_at: String::new(),
            },
            NOW,
        )
        .unwrap()
    }

    fn sample(list: Option<i64>, cash: Option<i64>) -> Sample {
        Sample { list_cents: list, cash_cents: cash, installments_text: None, in_stock: Some(true) }
    }

    fn views(conn: &Connection) -> Vec<ItemView> {
        let s = load_settings(conn);
        load_views(conn, None, &s, NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(), FixedOffset::east_opt(0).unwrap(), Path::new("."))
            .unwrap()
    }

    #[test]
    fn migration_is_idempotent_and_seeds_templates() {
        let c = mem();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert_eq!(count(&c, "alert_rules"), 0);
        let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        assert_eq!(list_templates(&c).unwrap().len(), 6);
    }

    #[test]
    fn item_crud_template_autoassign_and_validation() {
        let c = mem();
        let it = new_item(&c, "Ar-condicionado - 9000 btus", 2, Some(290000));
        assert_eq!(it.template_id.as_deref(), Some("ar-condicionado"));
        assert_eq!(it.specs.get("btus").map(|s| s.as_str()), Some("9000"));
        let mut edit = it.clone();
        edit.notes = "LG".into();
        edit.bought = true; // ignorado
        let saved = upsert_item(&c, edit, "2026-11-06T00:00:00Z").unwrap();
        assert!(!saved.bought);
        assert_eq!(get_item(&c, &it.id).unwrap().unwrap().notes, "LG");
        assert!(upsert_item(&c, ComprasItem { name: " ".into(), ..it.clone() }, NOW).is_err());
        assert!(upsert_item(&c, ComprasItem { qty: -1, ..it.clone() }, NOW).is_err());
        assert!(upsert_item(&c, ComprasItem { id: "nope".into(), ..it.clone() }, NOW).is_err());
    }

    #[test]
    fn image_save_bumps_updated_at() {
        let c = mem();
        let it = new_item(&c, "Coifa", 1, None);
        set_item_image(&c, &it.id, "images/x.png", "2026-12-01T00:00:00Z").unwrap();
        let got = get_item(&c, &it.id).unwrap().unwrap();
        assert_eq!(got.image_path.as_deref(), Some("images/x.png"));
        assert_eq!(got.updated_at, "2026-12-01T00:00:00Z");
        assert!(set_item_image(&c, "nope", "x", NOW).is_err());
    }

    #[test]
    fn offer_adapter_detection_and_manual_status() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://www.kabum.com.br/produto/1/x"), "");
        assert_eq!(o.adapter, OfferAdapter::Kabum);
        assert_eq!(o.store, "KaBuM");
        assert_eq!(o.status, OfferStatus::Pending);
        assert_eq!(o.next_poll_at.as_deref(), Some(NOW));
        let m = new_offer(&c, &it.id, None, "Mercado Livre");
        assert_eq!(m.adapter, OfferAdapter::Manual);
        assert_eq!(m.status, OfferStatus::Manual);
        assert_eq!(m.next_poll_at, None);
        // manual com URL de "abrir na loja": nunca é consultado
        let ml = upsert_offer(
            &c,
            ComprasOffer { adapter: OfferAdapter::Manual, url: Some("https://produto.mercadolivre.com.br/MLB-1".into()), ..m.clone() },
            NOW,
        )
        .unwrap();
        assert_eq!(ml.status, OfferStatus::Manual);
        let due = due_offers(&c, "2099-01-01T00:00:00Z").unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0, o.id);
        assert!(upsert_offer(&c, ComprasOffer { url: Some("ftp://x".into()), ..o.clone() }, NOW).is_err());
    }

    #[test]
    fn offer_url_change_resets_and_pause_toggle() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://www.kabum.com.br/produto/1/x"), "KaBuM");
        apply_poll_outcome(&c, &o.id, None, PollOutcome::Failure { kind: FailKind::Blocked, message: "x".into() }, 120, Utc::now(), 0.5).unwrap();
        let blocked = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!(blocked.status, OfferStatus::Blocked);
        let changed = upsert_offer(&c, ComprasOffer { url: Some("https://www.kabum.com.br/produto/2/y".into()), ..blocked.clone() }, NOW).unwrap();
        assert_eq!(changed.status, OfferStatus::Pending);
        assert_eq!(changed.fail_count, 0);
        let paused = upsert_offer(&c, ComprasOffer { status: OfferStatus::Paused, ..changed.clone() }, NOW).unwrap();
        assert_eq!(paused.status, OfferStatus::Paused);
        assert!(due_offers(&c, "2099-01-01T00:00:00Z").unwrap().is_empty());
        let resumed = upsert_offer(&c, ComprasOffer { status: OfferStatus::Pending, ..paused.clone() }, NOW).unwrap();
        assert_eq!(resumed.status, OfferStatus::Pending);
    }

    #[test]
    fn run_length_extends_unchanged_and_inserts_on_change() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        let r1 = record_auto_observation(&c, &o.id, &sample(Some(10000), Some(9000)), false, "2026-11-01T10:00:00Z").unwrap();
        let r2 = record_auto_observation(&c, &o.id, &sample(Some(10000), Some(9000)), false, "2026-11-02T10:00:00Z").unwrap();
        let r3 = record_auto_observation(&c, &o.id, &sample(Some(10000), Some(9000)), false, "2026-11-03T10:00:00Z").unwrap();
        assert_eq!((r1, r2, r3), (RecordOutcome::Inserted, RecordOutcome::Extended, RecordOutcome::Extended));
        let n: i64 = c.query_row("SELECT COUNT(*) FROM observations", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let last: String = c.query_row("SELECT last_seen_at FROM observations", [], |r| r.get(0)).unwrap();
        assert_eq!(last, "2026-11-03T10:00:00Z");
        // preço muda 10% -> nova linha confirmada
        let r4 = record_auto_observation(&c, &o.id, &sample(Some(10000), Some(8100)), false, "2026-11-04T10:00:00Z").unwrap();
        assert_eq!(r4, RecordOutcome::Inserted);
        // estoque muda -> nova linha
        let mut oos = sample(Some(10000), Some(8100));
        oos.in_stock = Some(false);
        assert_eq!(record_auto_observation(&c, &o.id, &oos, false, "2026-11-05T10:00:00Z").unwrap(), RecordOutcome::Inserted);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM observations", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn sanity_guard_unconfirmed_then_confirmed_within_2pct() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        record_auto_observation(&c, &o.id, &sample(Some(100000), None), false, "2026-11-01T10:00:00Z").unwrap();
        // queda de 50%: suspeito
        let r = record_auto_observation(&c, &o.id, &sample(Some(50000), None), false, "2026-11-02T10:00:00Z").unwrap();
        assert_eq!(r, RecordOutcome::Unconfirmed);
        let latest_confirmed = latest_obs(&c, &o.id, true).unwrap().unwrap();
        assert_eq!(latest_confirmed.list_cents, Some(100000));
        // próximo poll fora da banda (+10%): nova linha suspeita, não confirma
        let r = record_auto_observation(&c, &o.id, &sample(Some(55000), None), false, "2026-11-03T10:00:00Z").unwrap();
        assert_eq!(r, RecordOutcome::Unconfirmed);
        // dentro de ±2% da suspeita anterior: confirma
        let r = record_auto_observation(&c, &o.id, &sample(Some(55500), None), false, "2026-11-04T10:00:00Z").unwrap();
        assert_eq!(r, RecordOutcome::Confirmed);
        let latest_confirmed = latest_obs(&c, &o.id, true).unwrap().unwrap();
        assert_eq!(latest_confirmed.list_cents, Some(55500));
        // volta ao normal: estende a confirmada
        let r = record_auto_observation(&c, &o.id, &sample(Some(55500), None), false, "2026-11-05T10:00:00Z").unwrap();
        assert_eq!(r, RecordOutcome::Extended);
    }

    #[test]
    fn sanity_blip_is_never_confirmed_when_price_returns() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        record_auto_observation(&c, &o.id, &sample(Some(100000), None), false, "2026-11-01T10:00:00Z").unwrap();
        record_auto_observation(&c, &o.id, &sample(Some(10000), None), false, "2026-11-02T10:00:00Z").unwrap();
        let r = record_auto_observation(&c, &o.id, &sample(Some(100000), None), false, "2026-11-03T10:00:00Z").unwrap();
        assert_eq!(r, RecordOutcome::Inserted);
        let unconfirmed: i64 = c.query_row("SELECT COUNT(*) FROM observations WHERE confirmed=0", [], |r| r.get(0)).unwrap();
        assert_eq!(unconfirmed, 1);
        // stats/visões usam só confirmadas
        let v = views(&c);
        assert!(v[0].offers[0].latest.as_ref().unwrap().confirmed);
        assert_eq!(v[0].offers[0].latest.as_ref().unwrap().list_cents, Some(100000));
    }

    #[test]
    fn variant_guard_marks_suspect_and_never_confirms() {
        let c = mem();
        let mut it = new_item(&c, "Ar JE09F", 1, None);
        it.model_token = Some("JE09F".into());
        upsert_item(&c, it.clone(), NOW).unwrap();
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        let ex = |title: &str| Extracted { title: Some(title.into()), list_cents: Some(250000), in_stock: Some(true), ..Default::default() };
        let st = apply_poll_outcome(&c, &o.id, Some("JE09F"), PollOutcome::Success(ex("Ar Electrolux JE12F")), 120, Utc::now(), 0.5).unwrap();
        assert_eq!(st, Some(OfferStatus::Suspect));
        assert!(get_offer(&c, &o.id).unwrap().unwrap().last_error.unwrap().contains("JE09F"));
        assert!(latest_obs(&c, &o.id, true).unwrap().is_none());
        let st = apply_poll_outcome(&c, &o.id, Some("JE09F"), PollOutcome::Success(ex("Ar Electrolux JE09F")), 120, Utc::now(), 0.5).unwrap();
        assert_eq!(st, Some(OfferStatus::Ok));
        assert!(latest_obs(&c, &o.id, true).unwrap().is_some());
    }

    #[test]
    fn poll_failures_backoff_and_status_progression() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        let now = Utc.with_ymd_and_hms(2026, 11, 5, 12, 0, 0).unwrap();
        let fail = |k: FailKind| PollOutcome::Failure { kind: k, message: "falhou".into() };
        apply_poll_outcome(&c, &o.id, None, fail(FailKind::Transient), 120, now, 0.5).unwrap();
        let a = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!((a.fail_count, a.status), (1, OfferStatus::Pending));
        assert_eq!(a.next_poll_at.as_deref(), Some("2026-11-05T16:00:00Z")); // 120 min x 2
        apply_poll_outcome(&c, &o.id, None, fail(FailKind::Transient), 120, now, 0.5).unwrap();
        apply_poll_outcome(&c, &o.id, None, fail(FailKind::Transient), 120, now, 0.5).unwrap();
        let b = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!((b.fail_count, b.status), (3, OfferStatus::Broken));
        assert_eq!(b.next_poll_at.as_deref(), Some("2026-11-06T04:00:00Z")); // 120 min x 8 = 16 h
        apply_poll_outcome(&c, &o.id, None, fail(FailKind::Blocked), 120, now, 0.5).unwrap();
        let d = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!(d.status, OfferStatus::Blocked);
        assert_eq!(d.next_poll_at.as_deref(), Some("2026-11-06T12:00:00Z")); // cap 24 h
        // sucesso zera
        let ex = Extracted { title: Some("SSD X".into()), list_cents: Some(1000), in_stock: Some(true), sku: Some("S1".into()), ..Default::default() };
        apply_poll_outcome(&c, &o.id, None, PollOutcome::Success(ex), 120, now, 0.5).unwrap();
        let e = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!((e.fail_count, e.status, e.last_error.clone()), (0, OfferStatus::Ok, None));
        assert_eq!(e.title.as_deref(), Some("SSD X"));
        assert_eq!(e.sku.as_deref(), Some("S1"));
        assert_eq!(e.next_poll_at.as_deref(), Some("2026-11-05T14:00:00Z"));
    }

    #[test]
    fn price_basis_flags_drive_final_and_stats() {
        let c = mem();
        let it = new_item(&c, "Geladeira", 1, Some(444900));
        let mut a = new_offer(&c, &it.id, None, "Sam's");
        a.shipping_cents = Some(15000);
        let a = upsert_offer(&c, a, NOW).unwrap();
        add_manual_price(&c, &a.id, Some(450000), Some(440000), Some(true), "2026-11-05T10:00:00Z").unwrap();
        let get = |c: &Connection| views(c).remove(0);

        // padrão: à vista + frete
        let v = get(&c);
        assert_eq!(v.best.as_ref().unwrap().final_cents, Some(455000));
        assert_eq!(v.stats.current_final_cents, Some(455000));
        assert_eq!(v.stats.min_cents, Some(455000));
        assert_eq!(v.sparkline.len(), 30);
        assert_eq!(v.sparkline[29], Some(455000));
        assert_eq!(v.sparkline[0], None);
        assert_eq!(v.verdict, Some(Verdict::Collecting));

        // sem frete
        let mut s = ComprasSettings::default();
        s.include_shipping = false;
        save_settings(&c, s).unwrap();
        let v = get(&c);
        let b = v.best.as_ref().unwrap();
        assert_eq!(b.final_cents, Some(440000));
        assert_eq!(b.effective_cash_cents, Some(440000));
        assert_eq!(v.stats.min_cents, Some(440000));
        assert_eq!(v.sparkline[29], Some(440000));

        // sem Pix: preço de lista (com frete)
        let mut s = ComprasSettings::default();
        s.use_pix = false;
        save_settings(&c, s).unwrap();
        let v = get(&c);
        let b = v.best.as_ref().unwrap();
        assert_eq!(b.effective_cash_cents, Some(450000));
        assert_eq!(b.cash_source, Some(CashSource::List));
        assert_eq!(b.final_cents, Some(465000));
        assert_eq!(v.stats.min_cents, Some(465000));

        // os dois desligados: lista pura
        let mut s = ComprasSettings::default();
        s.use_pix = false;
        s.include_shipping = false;
        save_settings(&c, s).unwrap();
        assert_eq!(get(&c).best.unwrap().final_cents, Some(450000));
    }

    #[test]
    fn poll_is_ignored_for_paused_or_deleted_offers() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        mark_bought(&c, &ComprasPurchase { item_id: it.id.clone(), paid_unit_cents: 1, shipping_cents: 0, store: String::new(), purchased_at: String::new(), notes: String::new() }, NOW).unwrap();
        let ex = Extracted { list_cents: Some(1000), ..Default::default() };
        assert_eq!(apply_poll_outcome(&c, &o.id, None, PollOutcome::Success(ex.clone()), 120, Utc::now(), 0.5).unwrap(), None);
        delete_offer(&c, &o.id).unwrap();
        assert_eq!(apply_poll_outcome(&c, &o.id, None, PollOutcome::Success(ex), 120, Utc::now(), 0.5).unwrap(), None);
    }

    #[test]
    fn manual_price_final_is_cash_plus_shipping_and_best_picks_lowest() {
        let c = mem();
        let it = new_item(&c, "Geladeira", 1, Some(444900));
        let mut a = new_offer(&c, &it.id, None, "Sam's");
        a.shipping_cents = Some(15000);
        let a = upsert_offer(&c, a, NOW).unwrap();
        let b = new_offer(&c, &it.id, None, "Amazon");
        add_manual_price(&c, &a.id, Some(450000), Some(440000), Some(true), "2026-11-05T10:00:00Z").unwrap();
        add_manual_price(&c, &b.id, Some(452000), None, Some(true), "2026-11-05T10:00:00Z").unwrap();
        let mut s = ComprasSettings::default();
        s.pix_discount_by_store.insert("Amazon".into(), 5.0);
        save_settings(&c, s.clone()).unwrap();
        let v = views(&c);
        let ov: HashMap<_, _> = v[0].offers.iter().map(|o| (o.offer.store.clone(), o)).collect();
        assert_eq!(ov["Sam's"].effective_cash_cents, Some(440000));
        assert_eq!(ov["Sam's"].cash_source, Some(CashSource::Page));
        assert_eq!(ov["Sam's"].final_cents, Some(455000)); // 440000 + 15000 frete
        assert!(ov["Sam's"].shipping_known);
        assert_eq!(ov["Amazon"].effective_cash_cents, Some(429400)); // 452000 x 0,95
        assert_eq!(ov["Amazon"].cash_source, Some(CashSource::Estimated));
        assert_eq!(ov["Amazon"].final_cents, Some(429400));
        assert!(!ov["Amazon"].shipping_known);
        assert_eq!(v[0].best.as_ref().unwrap().offer.store, "Amazon");
        // sem estoque tira da disputa
        add_manual_price(&c, &b.id, Some(452000), None, Some(false), "2026-11-05T11:00:00Z").unwrap();
        let v = views(&c);
        assert_eq!(v[0].best.as_ref().unwrap().offer.store, "Sam's");
        assert!(add_manual_price(&c, &b.id, None, None, None, NOW).is_err());
        assert!(add_manual_price(&c, "nope", Some(1), None, None, NOW).is_err());
    }

    #[test]
    fn mark_bought_pauses_offers_and_unmark_resumes() {
        let c = mem();
        let it = new_item(&c, "SSD", 2, Some(100000));
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        let m = new_offer(&c, &it.id, None, "Meli");
        mark_bought(
            &c,
            &ComprasPurchase { item_id: it.id.clone(), paid_unit_cents: 90000, shipping_cents: 5000, store: "Loja".into(), purchased_at: String::new(), notes: String::new() },
            "2026-11-06T00:00:00Z",
        )
        .unwrap();
        let v = views(&c);
        assert!(v[0].item.bought);
        assert_eq!(v[0].purchase.as_ref().unwrap().purchased_at, "2026-11-06T00:00:00Z");
        assert_eq!(get_offer(&c, &o.id).unwrap().unwrap().status, OfferStatus::Paused);
        assert_eq!(get_offer(&c, &m.id).unwrap().unwrap().status, OfferStatus::Manual);
        let b = budget_summary(&v);
        assert_eq!(b.bought_cents, 2 * 90000 + 5000);
        unmark_bought(&c, &it.id, "2026-11-07T00:00:00Z").unwrap();
        let v = views(&c);
        assert!(!v[0].item.bought && v[0].purchase.is_none());
        assert_eq!(get_offer(&c, &o.id).unwrap().unwrap().status, OfferStatus::Pending);
        assert!(mark_bought(&c, &ComprasPurchase { item_id: "nope".into(), paid_unit_cents: 1, shipping_cents: 0, store: String::new(), purchased_at: String::new(), notes: String::new() }, NOW).is_err());
    }

    #[test]
    fn delete_item_cascades() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, None, "Meli");
        add_manual_price(&c, &o.id, Some(100), None, Some(true), NOW).unwrap();
        mark_bought(&c, &ComprasPurchase { item_id: it.id.clone(), paid_unit_cents: 1, shipping_cents: 0, store: String::new(), purchased_at: String::new(), notes: String::new() }, NOW).unwrap();
        delete_item(&c, &it.id).unwrap();
        for t in ["items", "offers", "observations", "purchases"] {
            let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{t}");
        }
        assert!(delete_item(&c, &it.id).is_err());
    }

    #[test]
    fn budget_summary_math_and_categories() {
        let c = mem();
        let a = new_item(&c, "Geladeira", 1, Some(444900));
        let b = new_item(&c, "Cabides", 3, Some(7590));
        let d = new_item(&c, "Luminárias", 0, Some(100000));
        let o = new_offer(&c, &a.id, None, "Sam's");
        add_manual_price(&c, &o.id, None, Some(400000), Some(true), "2026-11-05T10:00:00Z").unwrap();
        mark_bought(&c, &ComprasPurchase { item_id: b.id.clone(), paid_unit_cents: 7590, shipping_cents: 0, store: String::new(), purchased_at: String::new(), notes: String::new() }, NOW).unwrap();
        let _ = d;
        let s = budget_summary(&views(&c));
        assert_eq!(s.total_budget_cents, 444900 + 3 * 7590);
        assert_eq!(s.bought_cents, 22770);
        assert_eq!(s.remaining_budget_cents, 444900);
        assert_eq!(s.remaining_at_current_cents, 400000);
        assert_eq!(s.priced_items, 1);
        assert_eq!((s.items_total, s.items_bought), (3, 1));
        assert!((s.pct_done - 22770.0 / 467670.0).abs() < 1e-9);
        assert_eq!(s.by_category.len(), 1);
        assert_eq!(s.by_category[0].current_cents, 22770 + 400000);
    }

    #[test]
    fn history_daily_min_and_window() {
        let c = mem();
        let it = new_item(&c, "Coifa", 1, None);
        let o = new_offer(&c, &it.id, None, "Loja");
        add_manual_price(&c, &o.id, Some(10000), None, Some(true), "2026-11-01T12:00:00Z").unwrap();
        add_manual_price(&c, &o.id, Some(9000), None, Some(true), "2026-11-03T12:00:00Z").unwrap();
        let s = load_settings(&c);
        let tz = FixedOffset::east_opt(0).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 11, 5).unwrap();
        let h = history(&c, &it.id, None, &s, today, tz).unwrap();
        let dates: Vec<_> = h.iter().map(|p| p.date.as_str()).collect();
        assert_eq!(dates, ["2026-11-01", "2026-11-03"]);
        assert_eq!(h[1].best_final_cents, Some(9000));
        assert_eq!(h[1].per_offer[&o.id], Some(9000));
        let h = history(&c, &it.id, Some(2), &s, today, tz).unwrap();
        assert_eq!(h.len(), 1);
        assert!(history(&c, "nope", None, &s, today, tz).is_err());
    }

    #[test]
    fn settings_roundtrip_and_clamp() {
        let c = mem();
        assert_eq!(load_settings(&c), ComprasSettings::default());
        let mut s = ComprasSettings::default();
        s.poll_interval_minutes = 5;
        s.amazon_min_interval_minutes = 10;
        s.cep = Some("  ".into());
        s.pix_discount_by_store.insert("Amazon".into(), 5.0);
        s.pix_discount_by_store.insert("Ruim".into(), 150.0);
        let saved = save_settings(&c, s).unwrap();
        assert_eq!(saved.poll_interval_minutes, 60);
        assert_eq!(saved.amazon_min_interval_minutes, 360);
        assert_eq!(saved.cep, None);
        assert_eq!(load_settings(&c), saved);
        assert_eq!(saved.pix_discount_by_store.len(), 1);
    }

    #[test]
    fn mark_due_and_due_offers() {
        let c = mem();
        let it = new_item(&c, "SSD", 1, None);
        let o = new_offer(&c, &it.id, Some("https://loja.exemplo.com/p"), "Loja");
        apply_poll_outcome(&c, &o.id, None, PollOutcome::Success(Extracted { list_cents: Some(100), ..Default::default() }), 120, Utc.with_ymd_and_hms(2026, 11, 5, 12, 0, 0).unwrap(), 0.5).unwrap();
        assert!(due_offers(&c, NOW).unwrap().is_empty());
        let n = mark_due(&c, Some(&it.id), None, NOW).unwrap();
        assert_eq!(n, 1);
        assert_eq!(due_offers(&c, NOW).unwrap().len(), 1);
        assert_eq!(mark_due(&c, None, Some("nope"), NOW).unwrap(), 0);
    }

    #[test]
    fn template_upsert_validation() {
        let c = mem();
        let t = upsert_template(&c, CategoryTemplate { id: String::new(), name: "Micro-ondas".into(), fields: vec![SpecField { key: "litros".into(), label: "Litros".into(), kind: "number".into(), options: None, unit: Some("L".into()) }] }).unwrap();
        assert!(!t.id.is_empty());
        assert_eq!(list_templates(&c).unwrap().len(), 7);
        assert!(upsert_template(&c, CategoryTemplate { id: String::new(), name: "".into(), fields: vec![] }).is_err());
        let dup = SpecField { key: "a".into(), label: "A".into(), kind: "text".into(), options: None, unit: None };
        assert!(upsert_template(&c, CategoryTemplate { id: String::new(), name: "X".into(), fields: vec![dup.clone(), dup] }).is_err());
    }

    #[test]
    fn import_items_is_idempotent_and_transactional() {
        let c = mem();
        let rows = vec![
            SheetItem { bought: true, category: "Mão de Obra".into(), name: "Alvenaria Deck".into(), qty: 1, budget_unit_cents: Some(3900000), notes: String::new() },
            SheetItem { bought: false, category: "Eletros".into(), name: "Ar-condicionado - 24000 btus".into(), qty: 1, budget_unit_cents: Some(628100), notes: "Black".into() },
            SheetItem { bought: false, category: "Enxoval".into(), name: "Luminárias".into(), qty: 0, budget_unit_cents: Some(100000), notes: String::new() },
        ];
        let r = import_items(&c, &rows, NOW, ImportReport::default()).unwrap();
        assert_eq!((r.inserted, r.updated, r.bought_imported), (3, 0, 1));
        let r = import_items(&c, &rows, "2026-11-06T00:00:00Z", ImportReport::default()).unwrap();
        assert_eq!((r.inserted, r.updated, r.bought_imported), (0, 3, 0));
        let v = views(&c);
        assert_eq!(v.len(), 3);
        assert!(v[0].item.bought);
        assert_eq!(v[1].item.template_id.as_deref(), Some("ar-condicionado"));
        assert_eq!(v[1].item.specs.get("btus").map(|s| s.as_str()), Some("24000"));
        assert_eq!(v[2].item.qty, 0);
        let p = v[0].purchase.as_ref().unwrap();
        assert_eq!((p.paid_unit_cents, p.shipping_cents, p.notes.as_str()), (3900000, 0, "importado da planilha"));
        // duplicatas na planilha viram itens distintos
        let dup = vec![rows[2].clone(), rows[2].clone()];
        let r = import_items(&c, &dup, NOW, ImportReport::default()).unwrap();
        assert_eq!((r.inserted, r.updated), (1, 1));
    }

    #[test]
    fn seed_offer_records_preview_price_and_schedules_next_poll() {
        let c = mem();
        let it = new_item(&c, "Umidificador", 1, Some(40000));
        let o = new_offer(&c, &it.id, Some("https://www.amazon.com.br/dp/B0FZCT7GGZ"), "Amazon");
        let now = Utc.with_ymd_and_hms(2026, 11, 5, 12, 0, 0).unwrap();
        let seed = Extracted { title: Some("Umidificador Midea".into()), list_cents: Some(34314), in_stock: Some(true), ..Default::default() };
        seed_offer(&c, &o.id, seed, now, 0.5).unwrap();
        let after = get_offer(&c, &o.id).unwrap().unwrap();
        assert_eq!(after.status, OfferStatus::Ok);
        assert!(after.next_poll_at.as_deref().unwrap() > "2026-11-05T12:00:00Z");
        let obs = latest_obs(&c, &o.id, true).unwrap().unwrap();
        assert_eq!(obs.list_cents, Some(34314));
        assert_eq!(obs.source, ObsSource::Auto);
    }

    #[test]
    fn seed_offer_ignores_blocked_or_priceless_preview() {
        let c = mem();
        let it = new_item(&c, "Geladeira", 1, None);
        let o = new_offer(&c, &it.id, Some("https://www.mercadolivre.com.br/x"), "Mercado Livre");
        let now = Utc.with_ymd_and_hms(2026, 11, 5, 12, 0, 0).unwrap();
        seed_offer(&c, &o.id, Extracted { blocked: true, list_cents: Some(100), ..Default::default() }, now, 0.5).unwrap();
        seed_offer(&c, &o.id, Extracted::default(), now, 0.5).unwrap();
        assert!(latest_obs(&c, &o.id, false).unwrap().is_none());
        assert_eq!(get_offer(&c, &o.id).unwrap().unwrap().status, OfferStatus::Pending);
    }

    // ---------------------------------------------------------------- v2: migração, avisos, ajustes

    /// Banco no formato da v1 (como o app antigo deixou), com dados de todos os tipos.
    fn seed_v1(c: &Connection) {
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c.execute_batch(SCHEMA_V1).unwrap();
        c.pragma_update(None, "user_version", 1).unwrap();
        let t = "2026-10-01T12:00:00Z";
        for (id, name, target, bought) in [
            ("i1", "Geladeira", Some(250_000), 0),
            ("i2", "Cooktop", None, 0),
            ("i3", "Microondas", Some(80_000), 1),
        ] {
            c.execute(
                "INSERT INTO items(id, category, name, qty, budget_unit_cents, target_cents, notes, bought, specs, priority, created_at, updated_at)
                 VALUES (?1,'Eletros',?2,1,300000,?3,'',?4,'{}',1,?5,?5)",
                params![id, name, target, bought, t],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO offers(id, item_id, store, url, adapter, shipping_cents, status, created_at, next_poll_at)
             VALUES ('o1','i1','KaBuM','https://www.kabum.com.br/produto/1/x','kabum',1000,'ok',?1,?1)",
            params![t],
        )
        .unwrap();
        c.execute("INSERT INTO offers(id, item_id, store, adapter, status, created_at) VALUES ('o2','i2','Loja','manual','manual',?1)", params![t]).unwrap();
        c.execute(
            "INSERT INTO observations(id, offer_id, list_cents, cash_cents, in_stock, source, confirmed, first_seen_at, last_seen_at)
             VALUES ('b1','o1',300000,270000,1,'auto',1,?1,?1), ('b2','o1',100000,NULL,1,'auto',0,?1,?1), ('b3','o2',NULL,200000,1,'manual',1,?1,?1)",
            params![t],
        )
        .unwrap();
        c.execute("INSERT INTO purchases(item_id, paid_unit_cents, shipping_cents, store, purchased_at, notes) VALUES ('i3',75000,0,'Loja',?1,'')", params![t]).unwrap();
        c.execute(
            "INSERT INTO settings(key, value) VALUES('settings', ?1)",
            params![r#"{"pollEnabled":false,"pollIntervalMinutes":90,"amazonMinIntervalMinutes":400,"cep":"01001000","pixDiscountByStore":{"Amazon":5}}"#],
        )
        .unwrap();
    }

    fn count(c: &Connection, table: &str) -> i64 {
        c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn migrates_v1_shaped_db_keeping_data_and_backfilling_rules() {
        let c = Connection::open_in_memory().unwrap();
        seed_v1(&c);
        migrate(&c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert_eq!((count(&c, "items"), count(&c, "offers"), count(&c, "observations"), count(&c, "purchases")), (3, 2, 3, 1));
        // observação não confirmada continua não confirmada; compra e flags intactos
        let unconf: i64 = c.query_row("SELECT COUNT(*) FROM observations WHERE confirmed=0", [], |r| r.get(0)).unwrap();
        assert_eq!(unconf, 1);
        assert!(get_item(&c, "i3").unwrap().unwrap().bought);
        assert_eq!(get_item(&c, "i1").unwrap().unwrap().target_cents, Some(250_000));
        // backfill: um aviso por item com alvo, ligado, com novo-menor-preço, sem "já avisado" onde o preço está acima
        assert_eq!(count(&c, "alert_rules"), 2);
        let r1 = get_rule(&c, "i1").unwrap().unwrap();
        assert!(r1.enabled && r1.notify_new_low);
        assert_eq!(r1.target_cents, Some(250_000));
        assert!(get_rule(&c, "i2").unwrap().is_none());
        assert_eq!(count(&c, "alert_events"), 0);
        // configurações v1 carregam sem perder nada e ganham os padrões novos
        let s = load_settings(&c);
        assert!(!s.poll_enabled);
        assert_eq!(s.poll_interval_minutes, 90);
        assert_eq!(s.amazon_min_interval_minutes, 400);
        assert_eq!(s.cep.as_deref(), Some("01001000"));
        assert_eq!(s.pix_discount_by_store.get("Amazon"), Some(&5.0));
        assert_eq!((s.notify_enabled, s.cooldown_hours, s.max_toasts_per_cycle), (true, 24, 3));
        // views continuam funcionando e trazem a regra
        let vs = views(&c);
        assert_eq!(vs.len(), 3);
        assert!(vs.iter().find(|v| v.item.id == "i1").unwrap().alert.is_some());
        assert!(vs.iter().find(|v| v.item.id == "i2").unwrap().alert.is_none());
        // rodar de novo não mexe em nada
        migrate(&c).unwrap();
        assert_eq!(count(&c, "alert_rules"), 2);
    }

    #[test]
    fn migration_primes_rules_already_at_target_so_first_poll_does_not_spam() {
        let c = Connection::open_in_memory().unwrap();
        seed_v1(&c);
        // i1: melhor preço final 270000 + 1000 de frete; alvo 250000 -> acima; i2 sem alvo.
        // Coloca i2 com alvo acima do preço atual (200000) para ele já estar "no alvo".
        c.execute("UPDATE items SET target_cents=210000 WHERE id='i2'", []).unwrap();
        migrate(&c).unwrap();
        // observação de i1 e a manual de i2 estão com status ok/manual
        let r2 = get_rule(&c, "i2").unwrap().unwrap();
        assert_eq!(r2.last_alert_cents, Some(200_000), "já no alvo na migração: estado 'avisado', sem evento");
        assert_eq!(get_rule(&c, "i1").unwrap().unwrap().last_alert_cents, None);
        assert_eq!(count(&c, "alert_events"), 0);
    }

    #[test]
    fn newer_db_version_is_refused() {
        let c = Connection::open_in_memory().unwrap();
        seed_v1(&c);
        c.pragma_update(None, "user_version", SCHEMA_VERSION + 1).unwrap();
        assert!(migrate(&c).unwrap_err().contains("mais nova"));
    }

    #[test]
    fn file_db_is_backed_up_before_migrating_and_fresh_or_current_dbs_are_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("compras.db");
        {
            let c = Connection::open(&path).unwrap();
            seed_v1(&c);
        }
        let baks = |dir: &Path| -> Vec<std::path::PathBuf> {
            let mut v: Vec<_> = std::fs::read_dir(dir)
                .unwrap()
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("compras.db.bak-v"))
                .collect();
            v.sort();
            v
        };
        let c = open_file(&path).unwrap();
        let b = baks(dir.path());
        assert_eq!(b.len(), 1);
        let name = b[0].file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("compras.db.bak-v1-") && name.len() == "compras.db.bak-v1-".len() + 12, "{name}");
        // a cópia é o v1 original, intacta
        let bak = Connection::open(&b[0]).unwrap();
        let bv: i64 = bak.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(bv, 1);
        assert_eq!(count(&bak, "items"), 3);
        assert!(bak.query_row("SELECT COUNT(*) FROM alert_rules", [], |r| r.get::<_, i64>(0)).is_err());
        assert_eq!(count(&c, "alert_rules"), 2);
        drop(c);
        // reabrir um v2 não gera outro backup
        drop(open_file(&path).unwrap());
        assert_eq!(baks(dir.path()).len(), 1);
        // banco novo: nada para salvar
        let fresh = dir.path().join("sub").join("compras.db");
        drop(open_file(&fresh).unwrap());
        assert!(std::fs::read_dir(fresh.parent().unwrap()).unwrap().filter_map(|e| e.ok()).all(|e| !e.file_name().to_string_lossy().contains(".bak-")));
    }

    /// Manual: `COMPRAS_REAL_DB_COPY=<caminho de uma CÓPIA do banco real> cargo test real_db_copy -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_db_copy_migrates_and_reports_counts() {
        let Ok(p) = std::env::var("COMPRAS_REAL_DB_COPY") else {
            eprintln!("COMPRAS_REAL_DB_COPY não definido; nada a fazer");
            return;
        };
        let path = std::path::PathBuf::from(p);
        let tables = ["items", "offers", "observations", "purchases", "templates"];
        let before: Vec<(String, i64)> = {
            let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
            eprintln!("ANTES: user_version={v}");
            let with_target: i64 = c.query_row("SELECT COUNT(*) FROM items WHERE target_cents IS NOT NULL", [], |r| r.get(0)).unwrap();
            eprintln!("ANTES: items com target_cents={with_target}");
            tables.iter().map(|t| (t.to_string(), count(&c, t))).collect()
        };
        for (t, n) in &before {
            eprintln!("ANTES: {t}={n}");
        }
        let c = open_file(&path).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        eprintln!("DEPOIS: user_version={v}");
        for (t, n) in &before {
            let now = count(&c, t);
            eprintln!("DEPOIS: {t}={now}");
            if t != "templates" {
                assert_eq!(now, *n, "{t} mudou");
            }
        }
        // v1 -> v3: colunas novas, tudo desarquivado, sem cômodo, prioridade mapeada (0->1, 1->2)
        let v3_ok = v == SCHEMA_VERSION;
        assert!(v3_ok, "versão final {v}");
        let archived: i64 = c.query_row("SELECT COUNT(*) FROM items WHERE archived<>0 OR room IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(archived, 0);
        let mapped: i64 = c.query_row("SELECT COUNT(*) FROM items WHERE priority NOT IN (1, 2)", [], |r| r.get(0)).unwrap();
        assert_eq!(mapped, 0, "prioridade fora de 1..2 logo após a migração");
        eprintln!(
            "DEPOIS: prioridade Em breve={} Agora={}",
            c.query_row::<i64, _, _>("SELECT COUNT(*) FROM items WHERE priority=1", [], |r| r.get(0)).unwrap(),
            c.query_row::<i64, _, _>("SELECT COUNT(*) FROM items WHERE priority=2", [], |r| r.get(0)).unwrap()
        );
        eprintln!("DEPOIS: alert_rules={}", count(&c, "alert_rules"));
        eprintln!("DEPOIS: alert_events={}", count(&c, "alert_events"));
        let primed: i64 = c.query_row("SELECT COUNT(*) FROM alert_rules WHERE last_alert_cents IS NOT NULL", [], |r| r.get(0)).unwrap();
        eprintln!("DEPOIS: regras já 'avisadas' (preço atual no alvo na migração)={primed}");
        let with_target: i64 = c.query_row("SELECT COUNT(*) FROM items WHERE target_cents IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(count(&c, "alert_rules"), with_target);
        let s = load_settings(&c);
        eprintln!("DEPOIS: settings pix={:?} cep={:?}", s.pix_discount_by_store, s.cep);
        let n_views = views(&c).len() as i64;
        assert_eq!(n_views, before[0].1);
        let baks: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".bak-v"))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        eprintln!("BACKUPS: {baks:?}");
    }

    #[test]
    fn v1_settings_json_loads_without_losing_fields_and_defaults_fill_in() {
        let v1 = r#"{"pollEnabled":true,"pollIntervalMinutes":120,"amazonMinIntervalMinutes":360,"cep":"01001000","pixDiscountByStore":{"Amazon":5}}"#;
        let s: ComprasSettings = serde_json::from_str(v1).unwrap();
        assert_eq!(s.pix_discount_by_store.get("Amazon"), Some(&5.0));
        assert_eq!(s.cep.as_deref(), Some("01001000"));
        assert_eq!(s.quiet_start.as_deref(), Some("22:00"));
        assert_eq!(s.quiet_end.as_deref(), Some("08:00"));
        assert_eq!((s.max_toasts_per_cycle, s.cooldown_hours), (3, 24));
        assert!((s.realert_drop_pct - 3.0).abs() < f64::EPSILON && (s.default_target_pct - 10.0).abs() < f64::EPSILON);
        assert!(s.include_shipping && s.use_pix && s.notify_enabled && s.notify_new_low && s.rooms.is_empty());
        // JSON vazio e com campos desconhecidos também carregam
        assert_eq!(serde_json::from_str::<ComprasSettings>("{}").unwrap(), ComprasSettings::default());
        assert!(serde_json::from_str::<ComprasSettings>(r#"{"futuro":1,"cep":"x"}"#).is_ok());
        // quiet = null desliga e é respeitado (não volta ao padrão)
        let off: ComprasSettings = serde_json::from_str(r#"{"quietStart":null,"quietEnd":null}"#).unwrap();
        assert_eq!((off.quiet_start, off.quiet_end), (None, None));
    }

    #[test]
    fn save_settings_normalizes_new_fields() {
        let c = mem();
        let mut s = ComprasSettings::default();
        s.cooldown_hours = 0;
        s.realert_drop_pct = f64::NAN;
        s.max_toasts_per_cycle = 99;
        s.default_target_pct = 500.0;
        s.quiet_start = Some("7:30".into());
        s.quiet_end = Some("lixo".into());
        s.rooms = vec![" Sala ".into(), "sala".into(), "".into(), "Cozinha".into()];
        let saved = save_settings(&c, s).unwrap();
        assert_eq!((saved.cooldown_hours, saved.max_toasts_per_cycle), (1, 20));
        assert!((saved.realert_drop_pct - 3.0).abs() < f64::EPSILON);
        assert!((saved.default_target_pct - 90.0).abs() < f64::EPSILON);
        assert_eq!((saved.quiet_start.clone(), saved.quiet_end.clone()), (None, None), "um horário inválido desliga os dois");
        assert_eq!(saved.rooms, vec!["Sala", "Cozinha"]);
        assert_eq!(load_settings(&c), saved);
        let mut ok = ComprasSettings::default();
        ok.quiet_start = Some("7:30".into());
        ok.quiet_end = Some("22:15".into());
        let saved = save_settings(&c, ok).unwrap();
        assert_eq!((saved.quiet_start.as_deref(), saved.quiet_end.as_deref()), (Some("07:30"), Some("22:15")));
    }

    #[test]
    fn target_stays_in_sync_between_items_and_alert_rules() {
        let c = mem();
        let it = new_item(&c, "Geladeira", 1, Some(300_000));
        assert!(get_rule(&c, &it.id).unwrap().is_none(), "sem alvo: sem regra");

        // item -> regra
        let saved = upsert_item(&c, ComprasItem { target_cents: Some(250_000), ..it.clone() }, NOW).unwrap();
        assert_eq!(saved.target_cents, Some(250_000));
        let r = get_rule(&c, &it.id).unwrap().unwrap();
        assert_eq!((r.enabled, r.target_cents, r.notify_new_low), (true, Some(250_000), true));

        // regra -> item
        let (r, eval) = apply_rule_edit(&c, AlertRule { item_id: it.id.clone(), target_cents: Some(240_000), notify_new_low: false, ..Default::default() }, NOW).unwrap();
        assert!(eval && !r.notify_new_low);
        assert_eq!(get_item(&c, &it.id).unwrap().unwrap().target_cents, Some(240_000));

        // alterar o alvo pelo item zera o "já avisado" e religa
        set_alert_state(&c, &it.id, Some(230_000), Some(NOW)).unwrap();
        apply_rule_edit(&c, AlertRule { item_id: it.id.clone(), enabled: false, target_cents: Some(240_000), ..Default::default() }, NOW).unwrap();
        assert_eq!(get_rule(&c, &it.id).unwrap().unwrap().last_alert_cents, Some(230_000), "alvo igual: estado preservado");
        let it2 = get_item(&c, &it.id).unwrap().unwrap();
        upsert_item(&c, ComprasItem { target_cents: Some(200_000), ..it2.clone() }, NOW).unwrap();
        let r = get_rule(&c, &it.id).unwrap().unwrap();
        assert_eq!((r.enabled, r.target_cents, r.last_alert_cents, r.last_alert_at), (true, Some(200_000), None, None));

        // remover o alvo pelo item: a regra fica sem alvo
        upsert_item(&c, ComprasItem { target_cents: None, ..it2 }, NOW).unwrap();
        assert_eq!(get_rule(&c, &it.id).unwrap().unwrap().target_cents, None);

        // alvo removido pela regra: item também
        apply_rule_edit(&c, AlertRule { item_id: it.id.clone(), target_cents: Some(100_000), ..Default::default() }, NOW).unwrap();
        apply_rule_edit(&c, AlertRule { item_id: it.id.clone(), enabled: false, target_cents: None, ..Default::default() }, NOW).unwrap();
        assert_eq!(get_item(&c, &it.id).unwrap().unwrap().target_cents, None);

        // validações
        assert!(apply_rule_edit(&c, AlertRule { item_id: it.id.clone(), target_cents: Some(-1), ..Default::default() }, NOW).is_err());
        assert!(apply_rule_edit(&c, AlertRule { item_id: "nope".into(), ..Default::default() }, NOW).is_err());
    }

    #[test]
    fn item_created_with_target_gets_a_rule_and_delete_cascades() {
        let c = mem();
        let it = upsert_item(
            &c,
            ComprasItem {
                id: String::new(),
                category: "Eletros".into(),
                name: "Forno".into(),
                qty: 1,
                budget_unit_cents: None,
                target_cents: Some(90_000),
                notes: String::new(),
                bought: false,
                image_path: None,
                specs: BTreeMap::new(),
                template_id: None,
                model_token: None,
                priority: 1,
                created_at: String::new(),
                updated_at: String::new(),
                room: None,
                archived: false,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(get_rule(&c, &it.id).unwrap().unwrap().target_cents, Some(90_000));
        insert_event(
            &c,
            &AlertEvent {
                id: "e1".into(),
                item_id: it.id.clone(),
                offer_id: None,
                kind: AlertKind::Target,
                price_cents: 80_000,
                prev_cents: None,
                reason: "x".into(),
                created_at: NOW.into(),
                pending: false,
                seen: false,
                delivered_desktop: false,
                delivered_discord: false,
                item_name: String::new(),
                title: String::new(),
            },
        )
        .unwrap();
        assert_eq!(list_events(&c, 10, true).unwrap().len(), 1);
        assert_eq!(list_events(&c, 10, true).unwrap()[0].item_name, "Forno");
        delete_item(&c, &it.id).unwrap();
        assert_eq!((count(&c, "alert_rules"), count(&c, "alert_events")), (0, 0));
    }

    #[test]
    fn events_seen_delivered_snooze_and_bulk_target() {
        let c = mem();
        let a = new_item(&c, "A", 1, None);
        let b = new_item(&c, "B", 1, None);
        let mk = |id: &str, item: &str, pending: bool| AlertEvent {
            id: id.into(),
            item_id: item.into(),
            offer_id: None,
            kind: AlertKind::NewLow,
            price_cents: 1,
            prev_cents: Some(2),
            reason: "r".into(),
            created_at: format!("2026-11-08T10:0{}:00Z", id.len() % 10),
            pending,
            seen: false,
            delivered_desktop: false,
            delivered_discord: false,
            item_name: String::new(),
            title: String::new(),
        };
        insert_event(&c, &mk("e1", &a.id, false)).unwrap();
        insert_event(&c, &mk("e22", &b.id, true)).unwrap();
        assert_eq!(list_events(&c, 10, false).unwrap().len(), 2);
        assert_eq!(mark_events_seen(&c, Some(&["e1".to_string(), "zzz".to_string()])).unwrap(), 1);
        assert_eq!(list_events(&c, 10, true).unwrap().len(), 1);
        mark_delivered(&c, &["e22".to_string()], "desktop").unwrap();
        let all = list_events(&c, 10, false).unwrap();
        assert!(all.iter().find(|e| e.id == "e22").unwrap().delivered_desktop);
        assert!(!all.iter().find(|e| e.id == "e22").unwrap().delivered_discord);
        assert_eq!(mark_events_seen(&c, None).unwrap(), 1);
        assert!(list_events(&c, 10, true).unwrap().is_empty());
        // pendentes saem uma vez; item comprado no meio-tempo não volta
        assert!(has_pending_events(&c));
        mark_bought(&c, &ComprasPurchase { item_id: b.id.clone(), paid_unit_cents: 1, shipping_cents: 0, store: String::new(), purchased_at: String::new(), notes: String::new() }, NOW).unwrap();
        assert!(take_pending_events(&c).unwrap().is_empty());
        assert!(!has_pending_events(&c));

        // snooze exige regra e data válida
        assert!(set_snooze(&c, &a.id, Some("2026-12-01T00:00:00Z"), NOW).is_err());
        bulk_set_targets(&c, &[(a.id.clone(), 50_000), ("fantasma".into(), 1)], NOW).unwrap();
        assert!(set_snooze(&c, &a.id, Some("amanhã"), NOW).is_err());
        let r = set_snooze(&c, &a.id, Some("2026-12-01T00:00:00Z"), NOW).unwrap();
        assert_eq!(r.snooze_until.as_deref(), Some("2026-12-01T00:00:00Z"));
        assert_eq!(set_snooze(&c, &a.id, None, NOW).unwrap().snooze_until, None);
        assert_eq!(get_item(&c, &a.id).unwrap().unwrap().target_cents, Some(50_000));
        // editar a regra pela UI não apaga o snooze
        set_snooze(&c, &a.id, Some("2026-12-01T00:00:00Z"), NOW).unwrap();
        apply_rule_edit(&c, AlertRule { item_id: a.id.clone(), target_cents: Some(60_000), ..Default::default() }, NOW).unwrap();
        assert_eq!(get_rule(&c, &a.id).unwrap().unwrap().snooze_until.as_deref(), Some("2026-12-01T00:00:00Z"));
    }

    // ---------------------------------------------------------------- v3: cômodo, prioridade, arquivo

    /// Banco no formato da v2 (como a P1-P6 deixou), com prioridades 0 e 1.
    fn seed_v2(c: &Connection) {
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c.execute_batch(SCHEMA_V1).unwrap();
        c.execute_batch(SCHEMA_V2).unwrap();
        c.pragma_update(None, "user_version", 2).unwrap();
        let t = "2026-10-01T12:00:00Z";
        for (id, name, prio, target) in [("a", "Geladeira", 0, Some(250_000)), ("b", "Cooktop", 1, None), ("c", "Sofá", 0, None)] {
            c.execute(
                "INSERT INTO items(id, category, name, qty, budget_unit_cents, target_cents, notes, bought, specs, priority, created_at, updated_at)
                 VALUES (?1,'Casa',?2,1,100000,?3,'',0,'{}',?4,?5,?5)",
                params![id, name, target, prio, t],
            )
            .unwrap();
        }
        c.execute("INSERT INTO offers(id, item_id, store, adapter, status, created_at) VALUES ('o1','a','Loja','manual','manual',?1)", params![t]).unwrap();
        c.execute(
            "INSERT INTO observations(id, offer_id, cash_cents, in_stock, source, confirmed, first_seen_at, last_seen_at)
             VALUES ('b1','o1',200000,1,'manual',1,?1,?1)",
            params![t],
        )
        .unwrap();
        c.execute("INSERT INTO alert_rules(item_id, enabled, target_cents, notify_new_low, updated_at) VALUES ('a',1,250000,1,?1)", params![t]).unwrap();
    }

    #[test]
    fn migrates_v2_to_v3_adds_columns_and_maps_priority() {
        let c = Connection::open_in_memory().unwrap();
        seed_v2(&c);
        migrate(&c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);
        assert_eq!((count(&c, "items"), count(&c, "offers"), count(&c, "observations"), count(&c, "alert_rules")), (3, 1, 1, 1));
        // 0 (normal) -> 1 "Em breve"; 1 (alta) -> 2 "Agora"
        assert_eq!(get_item(&c, "a").unwrap().unwrap().priority, 1);
        assert_eq!(get_item(&c, "b").unwrap().unwrap().priority, 2);
        assert_eq!(get_item(&c, "c").unwrap().unwrap().priority, 1);
        for id in ["a", "b", "c"] {
            let i = get_item(&c, id).unwrap().unwrap();
            assert_eq!((i.room, i.archived), (None, false));
        }
        // rodar de novo não remapeia a prioridade
        migrate(&c).unwrap();
        assert_eq!(get_item(&c, "b").unwrap().unwrap().priority, 2);
        assert_eq!(get_item(&c, "a").unwrap().unwrap().priority, 1);
    }

    #[test]
    fn v1_to_v3_in_one_go_maps_priority_once_and_primes_rules() {
        let c = Connection::open_in_memory().unwrap();
        seed_v1(&c); // todos com prioridade 1 (alta)
        c.execute("UPDATE items SET target_cents=210000 WHERE id='i2'", []).unwrap();
        migrate(&c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);
        assert_eq!(get_item(&c, "i1").unwrap().unwrap().priority, 2);
        // a "preparação" das regras (pós v2) continua funcionando com as colunas da v3
        assert_eq!(get_rule(&c, "i2").unwrap().unwrap().last_alert_cents, Some(200_000));
    }

    #[test]
    fn file_db_v2_is_backed_up_before_v3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("compras.db");
        {
            let c = Connection::open(&path).unwrap();
            seed_v2(&c);
        }
        let c = open_file(&path).unwrap();
        let baks: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("compras.db.bak-v2-"))
            .collect();
        assert_eq!(baks.len(), 1);
        let bak = Connection::open(&baks[0]).unwrap();
        let bv: i64 = bak.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(bv, 2);
        // a cópia ainda é v2 (sem as colunas novas, prioridade original)
        assert!(bak.prepare("SELECT room FROM items").is_err());
        let p: i64 = bak.query_row("SELECT priority FROM items WHERE id='b'", [], |r| r.get(0)).unwrap();
        assert_eq!(p, 1);
        assert_eq!(get_item(&c, "b").unwrap().unwrap().priority, 2);
    }

    #[test]
    fn room_and_priority_validation_and_roundtrip() {
        let c = mem();
        let it = new_item(&c, "Sofá", 1, None);
        assert_eq!(it.priority, 1);
        let mut e = it.clone();
        e.room = Some("  Sala  ".into());
        e.priority = 9;
        let s = upsert_item(&c, e, NOW).unwrap();
        assert_eq!((s.room.as_deref(), s.priority), (Some("Sala"), 2));
        assert_eq!(get_item(&c, &it.id).unwrap().unwrap().room.as_deref(), Some("Sala"));
        let mut e = s.clone();
        e.room = Some("   ".into());
        e.priority = -3;
        let s = upsert_item(&c, e, NOW).unwrap();
        assert_eq!((s.room, s.priority), (None, 0));
        // JSON antigo (sem room/archived/priority) carrega com os padrões
        let old: ComprasItem = serde_json::from_str(r#"{"category":"X","name":"Y"}"#).unwrap();
        assert_eq!((old.room, old.archived, old.priority), (None, false, 1));
    }

    #[test]
    fn archived_flag_is_set_by_command_only_and_hidden_by_default() {
        let c = mem();
        let a = new_item(&c, "Geladeira", 1, Some(100_000));
        let b = new_item(&c, "Sofá", 1, Some(50_000));
        set_archived(&c, &a.id, true, NOW).unwrap();
        assert!(set_archived(&c, "nope", true, NOW).is_err());
        // salvar o item pela UI (archived=false no payload) não desarquiva
        let mut e = a.clone();
        e.notes = "x".into();
        let s = upsert_item(&c, e, NOW).unwrap();
        assert!(s.archived);
        assert!(get_item(&c, &a.id).unwrap().unwrap().archived);
        // criar com archived=true no payload é ignorado
        let mut n = b.clone();
        n.id = String::new();
        n.name = "Mesa".into();
        n.archived = true;
        assert!(!upsert_item(&c, n, NOW).unwrap().archived);
        // lista padrão esconde; com includeArchived volta tudo
        let all = views(&c);
        assert_eq!(all.len(), 3);
        let shown = visible_views(all.clone(), false);
        assert_eq!(shown.len(), 2);
        assert!(shown.iter().all(|v| v.item.id != a.id));
        assert_eq!(visible_views(all, true).len(), 3);
        set_archived(&c, &a.id, false, NOW).unwrap();
        assert_eq!(visible_views(views(&c), false).len(), 3);
    }

    #[test]
    fn archived_items_are_out_of_budget() {
        let c = mem();
        let _a = new_item(&c, "Geladeira", 1, Some(444_900));
        let b = new_item(&c, "Sofá", 2, Some(100_000));
        set_archived(&c, &b.id, true, NOW).unwrap();
        let s = budget_summary(&views(&c));
        assert_eq!((s.items_total, s.total_budget_cents, s.remaining_budget_cents), (1, 444_900, 444_900));
        assert_eq!(s.by_category.len(), 1);
        assert_eq!(s.by_category[0].budget_cents, 444_900);
    }

    #[test]
    fn archived_offers_are_not_polled() {
        let c = mem();
        let a = new_item(&c, "SSD", 1, None);
        let b = new_item(&c, "Monitor", 1, None);
        let oa = new_offer(&c, &a.id, Some("https://loja.exemplo.com/a"), "Amazon");
        let ob = new_offer(&c, &b.id, Some("https://loja.exemplo.com/b"), "Amazon");
        let due = |c: &Connection| -> Vec<String> {
            let mut v: Vec<String> = due_offers(c, NOW).unwrap().into_iter().map(|d| d.0).collect();
            v.sort();
            v
        };
        let mut both = vec![oa.id.clone(), ob.id.clone()];
        both.sort();
        assert_eq!(due(&c), both);
        set_archived(&c, &a.id, true, NOW).unwrap();
        assert_eq!(due(&c), vec![ob.id.clone()]);
        // "atualizar tudo" / por loja não acorda oferta arquivada
        c.execute("UPDATE offers SET next_poll_at='2099-01-01T00:00:00Z'", []).unwrap();
        assert!(due(&c).is_empty());
        assert_eq!(mark_due(&c, None, None, NOW).unwrap(), 1);
        assert_eq!(due(&c), vec![ob.id.clone()]);
        c.execute("UPDATE offers SET next_poll_at='2099-01-01T00:00:00Z'", []).unwrap();
        assert_eq!(mark_store_due(&c, "Amazon", NOW).unwrap(), 1);
        assert_eq!(due(&c), vec![ob.id.clone()]);
        // desarquivar volta a coletar
        set_archived(&c, &a.id, false, NOW).unwrap();
        assert_eq!(mark_due(&c, None, None, NOW).unwrap(), 2);
        assert_eq!(due(&c), both);
    }

    #[test]
    fn archived_items_are_skipped_by_bulk_target() {
        let c = mem();
        let a = new_item(&c, "Geladeira", 1, None);
        let b = new_item(&c, "Sofá", 1, None);
        for it in [&a, &b] {
            let o = new_offer(&c, &it.id, None, "Loja");
            add_manual_price(&c, &o.id, None, Some(100_000), Some(true), "2026-11-05T10:00:00Z").unwrap();
        }
        set_archived(&c, &b.id, true, NOW).unwrap();
        let ids = vec![a.id.clone(), b.id.clone()];
        let t = bulk_targets(&views(&c), &ids, 10.0);
        assert_eq!(t, vec![(a.id.clone(), 90_000)]);
    }

    #[test]
    fn archived_items_do_not_show_alert_events() {
        let c = mem();
        let a = new_item(&c, "Geladeira", 1, None);
        let ev = AlertEvent {
            id: "e1".into(),
            item_id: a.id.clone(),
            offer_id: None,
            kind: AlertKind::Target,
            price_cents: 1,
            prev_cents: None,
            reason: String::new(),
            created_at: NOW.into(),
            pending: true,
            seen: false,
            delivered_desktop: false,
            delivered_discord: false,
            title: String::new(),
            item_name: String::new(),
        };
        insert_event(&c, &ev).unwrap();
        assert_eq!(list_events(&c, 10, true).unwrap().len(), 1);
        set_archived(&c, &a.id, true, NOW).unwrap();
        assert!(list_events(&c, 10, false).unwrap().is_empty());
        assert!(take_pending_events(&c).unwrap().is_empty());
        set_archived(&c, &a.id, false, NOW).unwrap();
        assert_eq!(list_events(&c, 10, false).unwrap().len(), 1);
    }
}
