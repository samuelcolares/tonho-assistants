//! Módulo "Compras para Casa": rastreador de preços (SQLite + ticker próprio).
//! Contrato de comandos/structs: docs/compras.spec.md seção 4.

pub mod alerts;
pub mod db;
pub mod extract;
pub mod http;
pub mod images;
pub mod import_xlsx;
pub mod model;
pub mod money;
pub mod mercadolivre;
pub mod scheduler;
pub mod stats;
pub mod templates;

use chrono::{FixedOffset, Local, NaiveDate, Utc};
use http::{evaluate_response, extraction_basis, is_block_redirect, FailKind, Http, PollOutcome};
use model::*;
use rusqlite::Connection;
use serde_json::json;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVENT_UPDATED: &str = "compras://updated";
pub const EVENT_POLL_STATUS: &str = "compras://poll-status";
pub const EVENT_ALERT: &str = "compras://alert";

pub struct ComprasState {
    pub db: Mutex<Connection>,
    /// `app_config_dir/compras`
    pub dir: PathBuf,
    /// Se o banco não abriu, os comandos devolvem este erro (o app continua de pé).
    pub init_error: Option<String>,
    /// (força, condvar): `true` = atualização manual (ignora "polling desligado").
    pub wake: (Mutex<bool>, Condvar),
    pub poll_status: Mutex<PollStatus>,
    pub http: Arc<Http>,
    /// Token de app do Mercado Livre (cache).
    pub ml: Arc<mercadolivre::MlAuth>,
}

impl ComprasState {
    fn conn(&self) -> Result<MutexGuard<'_, Connection>, String> {
        if let Some(e) = &self.init_error {
            return Err(e.clone());
        }
        Ok(self.db.lock().unwrap_or_else(|p| p.into_inner()))
    }

    fn wake(&self, force: bool) {
        let (m, cv) = &self.wake;
        let mut g = m.lock().unwrap_or_else(|p| p.into_inner());
        if force {
            *g = true;
        }
        cv.notify_all();
    }
}

/// Abre o banco e monta o estado. Nunca derruba o app: em falha guarda `init_error`.
pub fn init(app: &AppHandle) -> Result<ComprasState, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map(|d| d.join("compras"))
        .unwrap_or_else(|_| std::env::temp_dir().join("tonho-compras"));
    let (conn, init_error) = match db::open_file(&dir.join("compras.db")) {
        Ok(c) => (c, None),
        Err(e) => {
            eprintln!("[compras] falha ao abrir o banco: {e}");
            let mem = Connection::open_in_memory().map_err(|e| format!("Compras indisponível: {e}"))?;
            (mem, Some(format!("Não foi possível abrir o banco de Compras: {e}")))
        }
    };
    Ok(ComprasState {
        db: Mutex::new(conn),
        dir,
        init_error,
        wake: (Mutex::new(false), Condvar::new()),
        poll_status: Mutex::new(PollStatus::default()),
        http: Arc::new(Http::new()),
        ml: Arc::new(mercadolivre::MlAuth::default()),
    })
}

fn state(app: &AppHandle) -> Result<State<'_, ComprasState>, String> {
    app.try_state::<ComprasState>().ok_or_else(|| "O módulo Compras não foi inicializado.".to_string())
}

fn now_s() -> String {
    db::ts(Utc::now())
}

fn local_tz() -> FixedOffset {
    *Local::now().offset()
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn emit_updated(app: &AppHandle, item_id: Option<&str>) {
    let _ = app.emit(EVENT_UPDATED, json!({ "itemId": item_id }));
}

fn emit_status(app: &AppHandle, s: &PollStatus) {
    let _ = app.emit(EVENT_POLL_STATUS, s.clone());
}

fn update_status(app: &AppHandle, st: &ComprasState, f: impl FnOnce(&mut PollStatus)) {
    let snapshot = {
        let mut g = st.poll_status.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut g);
        g.clone()
    };
    emit_status(app, &snapshot);
}

fn view_of(conn: &Connection, st: &ComprasState, id: &str) -> Result<ItemView, String> {
    let settings = db::load_settings(conn);
    db::load_views(conn, Some(id), &settings, today(), local_tz(), &st.dir)?
        .into_iter()
        .next()
        .ok_or_else(|| "Item não encontrado.".to_string())
}

// ---------------------------------------------------------------- avisos (plumbing)

/// Avalia o item e devolve os eventos novos (já gravados). Falha vira log: nunca derruba quem chamou.
fn run_eval(
    conn: &Connection,
    settings: &ComprasSettings,
    item_id: &str,
    trigger: alerts::Trigger,
    before: Option<&alerts::Snapshot>,
) -> Vec<alerts::NewAlert> {
    let ctx = alerts::EvalCtx { now: Utc::now(), tz: local_tz(), settings };
    match alerts::evaluate(conn, item_id, trigger, before, &ctx) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[compras] falha ao avaliar avisos de {item_id}: {e}");
            Vec::new()
        }
    }
}

fn snapshot_for(conn: &Connection, settings: &ComprasSettings, item_id: Option<&str>) -> Option<alerts::Snapshot> {
    let ctx = alerts::EvalCtx { now: Utc::now(), tz: local_tz(), settings };
    alerts::snapshot(conn, item_id?, &ctx)
}

/// Entrega os avisos novos: notifica (limite por ciclo, sem segurar o banco), grava o que foi entregue
/// e emite `compras://alert`. O evento já está no banco antes de qualquer notificação.
fn dispatch(app: &AppHandle, new_alerts: Vec<alerts::NewAlert>) {
    if new_alerts.is_empty() {
        return;
    }
    let Ok(st) = state(app) else { return };
    let max = st.conn().map(|c| db::load_settings(&c).max_toasts_per_cycle).unwrap_or(3).max(1) as usize;
    let to_toast: Vec<AlertEvent> = new_alerts.iter().filter(|a| a.toast).map(|a| a.event.clone()).collect();
    let mut desktop_ok: Vec<String> = Vec::new();
    if !to_toast.is_empty() {
        let plan = alerts::plan_toasts(&to_toast, max);
        let desktop = alerts::DesktopChannel { app: app.clone() };
        let channels: [&dyn alerts::AlertChannel; 1] = [&desktop];
        for d in alerts::deliver(&channels, &plan) {
            if d.event_ids.is_empty() {
                continue;
            }
            if let Ok(conn) = st.conn() {
                if let Err(e) = db::mark_delivered(&conn, &d.event_ids, d.channel) {
                    eprintln!("[compras] falha ao registrar entrega do aviso: {e}");
                }
            }
            if d.channel == "desktop" {
                desktop_ok.extend(d.event_ids);
            }
        }
    }
    for a in new_alerts {
        let mut ev = a.event;
        ev.delivered_desktop = desktop_ok.contains(&ev.id);
        let _ = app.emit(EVENT_ALERT, ev);
    }
}

/// Entrega o que o horário silencioso segurou, quando ele termina.
fn flush_pending(app: &AppHandle) {
    let Ok(st) = state(app) else { return };
    let (events, notify) = {
        let Ok(conn) = st.conn() else { return };
        if !db::has_pending_events(&conn) {
            return;
        }
        let s = db::load_settings(&conn);
        let local = Utc::now().with_timezone(&local_tz()).time();
        if alerts::in_quiet_hours(local, s.quiet_start.as_deref(), s.quiet_end.as_deref()) {
            return;
        }
        match db::take_pending_events(&conn) {
            Ok(e) => (e, s.notify_enabled),
            Err(e) => {
                eprintln!("[compras] falha ao ler avisos pendentes: {e}");
                return;
            }
        }
    };
    dispatch(app, events.into_iter().map(|event| alerts::NewAlert { event, toast: notify }).collect());
}

// ---------------------------------------------------------------- comandos

#[tauri::command(async)]
pub fn compras_list_items(app: AppHandle, include_archived: Option<bool>) -> Result<Vec<ItemView>, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    let settings = db::load_settings(&conn);
    let views = db::load_views(&conn, None, &settings, today(), local_tz(), &st.dir)?;
    Ok(db::visible_views(views, include_archived.unwrap_or(false)))
}

/// Arquiva (ou desarquiva) um item: some das listas, do orçamento, dos avisos e da coleta, sem apagar nada.
#[tauri::command(async)]
pub fn compras_archive_item(app: AppHandle, id: String, archived: bool) -> Result<ItemView, String> {
    let st = state(&app)?;
    let view = {
        let conn = st.conn()?;
        db::set_archived(&conn, &id, archived, &now_s())?;
        view_of(&conn, &st, &id)?
    };
    if !archived {
        st.wake(false);
    }
    emit_updated(&app, Some(&id));
    Ok(view)
}

#[tauri::command(async)]
pub fn compras_get_item(app: AppHandle, id: String) -> Result<ItemView, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    view_of(&conn, &st, &id)
}

#[tauri::command(async)]
pub fn compras_upsert_item(app: AppHandle, item: ComprasItem) -> Result<ComprasItem, String> {
    let st = state(&app)?;
    let (saved, new_alerts) = {
        let conn = st.conn()?;
        let before_target = if item.id.trim().is_empty() { None } else { db::get_item(&conn, &item.id)?.and_then(|i| i.target_cents) };
        let saved = db::upsert_item(&conn, item, &now_s())?;
        let mut new_alerts = Vec::new();
        // alvo novo/alterado: se o preço já está no alvo, registra o evento (sem toast)
        if saved.target_cents.is_some() && saved.target_cents != before_target {
            let settings = db::load_settings(&conn);
            new_alerts = run_eval(&conn, &settings, &saved.id, alerts::Trigger::RuleChange, None);
        }
        (saved, new_alerts)
    };
    emit_updated(&app, Some(&saved.id));
    dispatch(&app, new_alerts);
    Ok(saved)
}

#[tauri::command(async)]
pub fn compras_delete_item(app: AppHandle, id: String) -> Result<(), String> {
    let st = state(&app)?;
    {
        let conn = st.conn()?;
        db::delete_item(&conn, &id)?;
    }
    images::remove_all(&st.dir.join("images"), &id);
    emit_updated(&app, Some(&id));
    Ok(())
}

#[tauri::command(async)]
pub fn compras_mark_bought(app: AppHandle, purchase: ComprasPurchase) -> Result<ItemView, String> {
    let st = state(&app)?;
    let view = {
        let conn = st.conn()?;
        db::mark_bought(&conn, &purchase, &now_s())?;
        view_of(&conn, &st, &purchase.item_id)?
    };
    emit_updated(&app, Some(&purchase.item_id));
    Ok(view)
}

#[tauri::command(async)]
pub fn compras_unmark_bought(app: AppHandle, item_id: String) -> Result<ItemView, String> {
    let st = state(&app)?;
    let view = {
        let conn = st.conn()?;
        db::unmark_bought(&conn, &item_id, &now_s())?;
        view_of(&conn, &st, &item_id)?
    };
    st.wake(false);
    emit_updated(&app, Some(&item_id));
    Ok(view)
}

#[tauri::command(async)]
pub fn compras_upsert_offer(app: AppHandle, offer: ComprasOffer, seed: Option<Extracted>) -> Result<ComprasOffer, String> {
    let st = state(&app)?;
    let (saved, new_alerts) = {
        let conn = st.conn()?;
        let is_new = offer.id.trim().is_empty();
        let saved = db::upsert_offer(&conn, offer, &now_s())?;
        match seed {
            // a prévia já trouxe o preço: grava como primeira consulta em vez de esperar o ticker
            Some(seed) if is_new => {
                let settings = db::load_settings(&conn);
                let before = snapshot_for(&conn, &settings, Some(&saved.item_id));
                db::seed_offer(&conn, &saved.id, seed, Utc::now(), scheduler::rand01())?;
                let new_alerts = run_eval(&conn, &settings, &saved.item_id, alerts::Trigger::Seed, before.as_ref());
                (db::get_offer(&conn, &saved.id)?.unwrap_or(saved), new_alerts)
            }
            _ => (saved, Vec::new()),
        }
    };
    st.wake(false);
    emit_updated(&app, Some(&saved.item_id));
    dispatch(&app, new_alerts);
    Ok(saved)
}

#[tauri::command(async)]
pub fn compras_delete_offer(app: AppHandle, id: String) -> Result<(), String> {
    let st = state(&app)?;
    let item_id = {
        let conn = st.conn()?;
        let item_id = db::offer_item_id(&conn, &id);
        db::delete_offer(&conn, &id)?;
        item_id
    };
    emit_updated(&app, item_id.as_deref());
    Ok(())
}

#[tauri::command(async)]
pub fn compras_add_manual_price(
    app: AppHandle,
    offer_id: String,
    list_cents: Option<i64>,
    cash_cents: Option<i64>,
    in_stock: Option<bool>,
) -> Result<ComprasObservation, String> {
    let st = state(&app)?;
    let (obs, item_id, new_alerts) = {
        let conn = st.conn()?;
        let item_id = db::offer_item_id(&conn, &offer_id);
        let settings = db::load_settings(&conn);
        let before = snapshot_for(&conn, &settings, item_id.as_deref());
        let obs = db::add_manual_price(&conn, &offer_id, list_cents, cash_cents, in_stock, &now_s())?;
        let new_alerts = match item_id.as_deref() {
            Some(id) => run_eval(&conn, &settings, id, alerts::Trigger::ManualPrice, before.as_ref()),
            None => Vec::new(),
        };
        (obs, item_id, new_alerts)
    };
    emit_updated(&app, item_id.as_deref());
    dispatch(&app, new_alerts);
    Ok(obs)
}

// ---------------------------------------------------------------- comandos de avisos

#[tauri::command(async)]
pub fn compras_get_alert(app: AppHandle, item_id: String) -> Result<Option<AlertRule>, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    db::get_rule(&conn, &item_id)
}

#[tauri::command(async)]
pub fn compras_set_alert(app: AppHandle, rule: AlertRule) -> Result<AlertRule, String> {
    let st = state(&app)?;
    let (saved, new_alerts) = {
        let conn = st.conn()?;
        let item_id = rule.item_id.clone();
        let (saved, needs_eval) = db::apply_rule_edit(&conn, rule, &now_s())?;
        let mut new_alerts = Vec::new();
        if needs_eval {
            let settings = db::load_settings(&conn);
            new_alerts = run_eval(&conn, &settings, &item_id, alerts::Trigger::RuleChange, None);
        }
        (db::get_rule(&conn, &item_id)?.unwrap_or(saved), new_alerts)
    };
    emit_updated(&app, Some(&saved.item_id));
    dispatch(&app, new_alerts);
    Ok(saved)
}

/// Avisar quando custar `pct_below_current`% menos que o preço atual. Pula itens comprados ou sem preço.
#[tauri::command(async)]
pub fn compras_bulk_set_target(app: AppHandle, item_ids: Vec<String>, pct_below_current: f64) -> Result<i64, String> {
    if !pct_below_current.is_finite() || pct_below_current <= 0.0 || pct_below_current >= 100.0 {
        return Err("Informe um percentual entre 0 e 100.".to_string());
    }
    let st = state(&app)?;
    let n = {
        let conn = st.conn()?;
        let settings = db::load_settings(&conn);
        let views = db::load_views(&conn, None, &settings, today(), local_tz(), &st.dir)?;
        let targets = db::bulk_targets(&views, &item_ids, pct_below_current);
        db::bulk_set_targets(&conn, &targets, &now_s())?
    };
    emit_updated(&app, None);
    Ok(n as i64)
}

#[tauri::command(async)]
pub fn compras_snooze_alert(app: AppHandle, item_id: String, until: Option<String>) -> Result<AlertRule, String> {
    let st = state(&app)?;
    let rule = {
        let conn = st.conn()?;
        db::set_snooze(&conn, &item_id, until.as_deref(), &now_s())?
    };
    emit_updated(&app, Some(&item_id));
    Ok(rule)
}

#[tauri::command(async)]
pub fn compras_list_alert_events(app: AppHandle, limit: Option<i64>, unseen_only: Option<bool>) -> Result<Vec<AlertEvent>, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    db::list_events(&conn, limit.unwrap_or(100), unseen_only.unwrap_or(false))
}

/// `ids` nulo = todos. Retorna quantos foram marcados.
#[tauri::command(async)]
pub fn compras_mark_events_seen(app: AppHandle, ids: Option<Vec<String>>) -> Result<i64, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    Ok(db::mark_events_seen(&conn, ids.as_deref())? as i64)
}

#[tauri::command(async)]
pub fn compras_test_notification(app: AppHandle) -> Result<(), String> {
    use alerts::AlertChannel;
    let toast = alerts::Toast {
        title: "Aviso de teste".to_string(),
        body: "Se você está vendo isto, os avisos de preço do Tonho estão funcionando.".to_string(),
        event_ids: Vec::new(),
    };
    alerts::DesktopChannel { app }.send(&toast).map_err(|e| format!("Não foi possível mostrar a notificação: {e}"))
}

/// Prévia para loja que redirecionou para verificação/captcha.
pub fn blocked_preview(url: &str) -> Extracted {
    Extracted {
        url: url.to_string(),
        store: extract::store_name(url),
        adapter: extract::detect_adapter(url),
        blocked: true,
        warnings: vec!["A loja pediu verificação (captcha/login) e bloqueou a consulta. Cadastre a oferta como manual.".to_string()],
        ..Default::default()
    }
}

/// Link curto/genérico que redirecionou para uma loja suportada (ex.: `a.co/...` -> Amazon):
/// a oferta passa a usar a URL final, para o adaptador certo valer também nas consultas.
pub fn finish_preview(mut e: Extracted, url: &str, final_url: &str) -> Extracted {
    let resolved = extraction_basis(url, final_url) == final_url
        && extract::detect_adapter(final_url) != OfferAdapter::Generic;
    e.url = if resolved { final_url.to_string() } else { url.to_string() };
    e.adapter = extract::detect_adapter(&e.url);
    if e.store.trim().is_empty() {
        e.store = extract::store_name(&e.url);
    }
    e
}

/// Resposta de uma página de pré-visualização -> `Extracted` (ou erro legível).
pub fn preview_from_response(status: u16, html: &str, url: &str) -> Result<Extracted, String> {
    let mut e = extract::extract(html, url);
    let has_price = e.list_cents.is_some() || e.cash_cents.is_some();
    if (status == 403 || status == 429) && !has_price {
        e.blocked = true;
        if !e.warnings.iter().any(|w| w.contains("bloquead")) {
            e.warnings.push(format!("A loja bloqueou a consulta (HTTP {status}). Cadastre a oferta como manual."));
        }
        return Ok(e);
    }
    if status >= 400 && !has_price {
        return Err(format!("A loja respondeu HTTP {status}; confira o link."));
    }
    Ok(e)
}

#[tauri::command]
pub async fn compras_preview_url(app: AppHandle, url: String) -> Result<Extracted, String> {
    let http = state(&app)?.http.clone();
    let ml = state(&app)?.ml.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let url = url.trim().to_string();
        if extract::detect_adapter(&url) == OfferAdapter::MercadoLivre {
            return mercadolivre::preview(&http, &ml, &url);
        }
        let (status, body, final_url) = http.fetch_page(&url)?;
        if is_block_redirect(&final_url) {
            return Ok(blocked_preview(&url));
        }
        Ok(finish_preview(preview_from_response(status, &body, extraction_basis(&url, &final_url))?, &url, &final_url))
    })
    .await
    .map_err(|e| format!("Falha interna na consulta: {e}"))?
}

fn finish_image(app: &AppHandle, item_id: &str, bytes: &[u8]) -> Result<String, String> {
    let st = state(app)?;
    let (abs, rel) = images::save_bytes(&st.dir, item_id, bytes)?;
    {
        let conn = st.conn()?;
        db::set_item_image(&conn, item_id, &rel, &now_s())?;
    }
    emit_updated(app, Some(item_id));
    Ok(abs.to_string_lossy().into_owned())
}

fn ensure_item_exists(app: &AppHandle, item_id: &str) -> Result<(), String> {
    let st = state(app)?;
    let conn = st.conn()?;
    if !images::valid_id(item_id) || db::get_item(&conn, item_id)?.is_none() {
        return Err("Item não encontrado.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn compras_save_image_from_url(app: AppHandle, item_id: String, url: String) -> Result<String, String> {
    ensure_item_exists(&app, &item_id)?;
    let http = state(&app)?.http.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = http.fetch_bytes(url.trim(), http::MAX_IMAGE_BYTES)?;
        finish_image(&app2, &item_id, &bytes)
    })
    .await
    .map_err(|e| format!("Falha interna ao baixar a imagem: {e}"))?
}

#[tauri::command(async)]
pub fn compras_set_image_from_file(app: AppHandle, item_id: String, path: String) -> Result<String, String> {
    ensure_item_exists(&app, &item_id)?;
    let bytes = images::read_user_file(&path)?;
    finish_image(&app, &item_id, &bytes)
}

#[tauri::command(async)]
pub fn compras_history(app: AppHandle, item_id: String, days: Option<i64>) -> Result<Vec<HistoryPoint>, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    let settings = db::load_settings(&conn);
    db::history(&conn, &item_id, days, &settings, today(), local_tz())
}

#[tauri::command(async)]
pub fn compras_budget_summary(app: AppHandle) -> Result<BudgetSummary, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    let settings = db::load_settings(&conn);
    let views = db::load_views(&conn, None, &settings, today(), local_tz(), &st.dir)?;
    Ok(db::budget_summary(&views))
}

#[tauri::command(async)]
pub fn compras_refresh(app: AppHandle, item_id: Option<String>, offer_id: Option<String>) -> Result<(), String> {
    let st = state(&app)?;
    let queued = {
        let conn = st.conn()?;
        // `offerId` tem precedência sobre `itemId`; ambos nulos = todas as ofertas.
        db::mark_due(&conn, item_id.as_deref(), offer_id.as_deref(), &now_s())? as i64
    };
    update_status(&app, &st, |s| s.queued = queued.max(s.queued));
    st.wake(true);
    Ok(())
}

#[tauri::command(async)]
pub fn compras_poll_status(app: AppHandle) -> Result<PollStatus, String> {
    let st = state(&app)?;
    let s = st.poll_status.lock().unwrap_or_else(|p| p.into_inner()).clone();
    Ok(s)
}

#[tauri::command(async)]
pub fn compras_list_templates(app: AppHandle) -> Result<Vec<CategoryTemplate>, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    db::list_templates(&conn)
}

#[tauri::command(async)]
pub fn compras_upsert_template(app: AppHandle, template: CategoryTemplate) -> Result<CategoryTemplate, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    db::upsert_template(&conn, template)
}

#[tauri::command(async)]
pub fn compras_get_settings(app: AppHandle) -> Result<ComprasSettings, String> {
    let st = state(&app)?;
    let conn = st.conn()?;
    Ok(db::load_settings(&conn))
}

#[tauri::command(async)]
pub fn compras_save_settings(app: AppHandle, settings: ComprasSettings) -> Result<(), String> {
    let st = state(&app)?;
    {
        let conn = st.conn()?;
        db::save_settings(&conn, settings)?;
    }
    st.wake(false);
    emit_updated(&app, None);
    Ok(())
}

#[tauri::command(async)]
pub fn compras_import_xlsx(app: AppHandle, path: String) -> Result<ImportReport, String> {
    let st = state(&app)?;
    let report = {
        let conn = st.conn()?;
        import_xlsx::import_file(&conn, &path, &now_s(), &st.dir, today(), local_tz())?
    };
    emit_updated(&app, None);
    Ok(report)
}

fn csv_cell(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// CSV pt-BR (separador `;`, decimais com vírgula, BOM UTF-8). Retorna (texto, nº de linhas de itens).
pub fn export_csv(views: &[ItemView]) -> (String, usize) {
    let mut out = String::from("\u{feff}");
    let header = [
        "Comprado", "Categoria", "Item", "Qtd", "Preço un. orçado", "Total orçado", "Melhor preço final", "Melhor loja",
        "Preço-alvo", "Pago un.", "Frete pago", "Loja da compra", "Observações",
    ];
    out.push_str(&header.join(";"));
    out.push_str("\r\n");
    let money = |c: Option<i64>| c.map(money::format_decimal_comma).unwrap_or_default();
    for v in views {
        let i = &v.item;
        let best_final = v.best.as_ref().and_then(|b| b.final_cents);
        let best_store = v.best.as_ref().map(|b| b.offer.store.clone()).unwrap_or_default();
        let cols = [
            if i.bought { "Sim".to_string() } else { "Não".to_string() },
            csv_cell(&i.category),
            csv_cell(&i.name),
            i.qty.to_string(),
            money(i.budget_unit_cents),
            money(i.budget_unit_cents.map(|b| b * i.qty)),
            money(best_final),
            csv_cell(&best_store),
            money(i.target_cents),
            money(v.purchase.as_ref().map(|p| p.paid_unit_cents)),
            money(v.purchase.as_ref().map(|p| p.shipping_cents)),
            csv_cell(&v.purchase.as_ref().map(|p| p.store.clone()).unwrap_or_default()),
            csv_cell(&i.notes),
        ];
        out.push_str(&cols.join(";"));
        out.push_str("\r\n");
    }
    (out, views.len())
}

#[tauri::command(async)]
pub fn compras_export_csv(app: AppHandle, path: String) -> Result<i64, String> {
    let st = state(&app)?;
    let (text, rows) = {
        let conn = st.conn()?;
        let settings = db::load_settings(&conn);
        let views = db::load_views(&conn, None, &settings, today(), local_tz(), &st.dir)?;
        export_csv(&views)
    };
    std::fs::write(&path, text).map_err(|e| format!("Não foi possível gravar o CSV: {e}"))?;
    Ok(rows as i64)
}

// ---------------------------------------------------------------- Mercado Livre (API oficial)

#[tauri::command(async)]
pub fn compras_ml_status() -> mercadolivre::MlStatus {
    mercadolivre::status()
}

/// Valida as credenciais pedindo um token antes de salvar no keyring.
#[tauri::command]
pub async fn compras_ml_save_credentials(app: AppHandle, client_id: String, client_secret: String) -> Result<mercadolivre::MlStatus, String> {
    let creds = mercadolivre::MlCredentials { client_id: client_id.trim().to_string(), client_secret: client_secret.trim().to_string() };
    if creds.client_id.is_empty() || creds.client_secret.is_empty() {
        return Err("Informe o App ID e a chave secreta.".to_string());
    }
    let http = state(&app)?.http.clone();
    let ml = state(&app)?.ml.clone();
    let checked = creds.clone();
    tauri::async_runtime::spawn_blocking(move || mercadolivre::request_token(&http, &checked))
        .await
        .map_err(|e| format!("Falha interna ao validar: {e}"))??;
    mercadolivre::save_credentials(&creds).map_err(|e| format!("Não foi possível salvar no cofre do Windows: {e}"))?;
    ml.invalidate();
    // ofertas do ML bloqueadas por falta de credencial: consulta de novo agora
    {
        let st = state(&app)?;
        let conn = st.conn()?;
        db::mark_store_due(&conn, mercadolivre::STORE, &now_s())?;
    }
    state(&app)?.wake(true);
    Ok(mercadolivre::status())
}

#[tauri::command(async)]
pub fn compras_ml_clear_credentials(app: AppHandle) -> Result<mercadolivre::MlStatus, String> {
    mercadolivre::clear_credentials().map_err(|e| format!("Não foi possível remover do cofre do Windows: {e}"))?;
    state(&app)?.ml.invalidate();
    Ok(mercadolivre::status())
}

// ---------------------------------------------------------------- ticker

/// Espera até `timeout` ou até alguém chamar `wake`. Retorna se foi atualização manual.
fn wait_for_wake(st: &ComprasState, timeout: Duration) -> bool {
    let (m, cv) = &st.wake;
    let mut g = m.lock().unwrap_or_else(|p| p.into_inner());
    if !*g {
        g = cv.wait_timeout(g, timeout).unwrap_or_else(|p| p.into_inner()).0;
    }
    let forced = *g;
    *g = false;
    forced
}

fn fetch_and_classify(http: &Http, ml: &mercadolivre::MlAuth, url: &str) -> PollOutcome {
    // pela URL (não pelo adaptador salvo): ofertas antigas do ML também passam a usar a API
    if extract::detect_adapter(url) == OfferAdapter::MercadoLivre {
        return mercadolivre::poll(http, ml, url);
    }
    match http.fetch_page(url) {
        Ok((status, body, final_url)) => {
            if is_block_redirect(&final_url) {
                return PollOutcome::Failure {
                    kind: FailKind::Blocked,
                    message: "A loja pediu verificação (captcha/login). Nova tentativa com espera maior; se persistir, use preço manual.".to_string(),
                };
            }
            evaluate_response(status, &body, extraction_basis(url, &final_url))
        }
        Err(message) => PollOutcome::Failure { kind: FailKind::Transient, message },
    }
}

/// Consulta uma oferta. Rede e parsing rodam sem nenhum lock; o banco só é tocado no início e no fim.
fn poll_one(app: &AppHandle, offer_id: &str) -> Vec<alerts::NewAlert> {
    let Ok(st) = state(app) else { return Vec::new() };
    let ctx = {
        let Ok(conn) = st.conn() else { return Vec::new() };
        match db::poll_context(&conn, offer_id) {
            Ok(Some(c)) => c,
            _ => return Vec::new(),
        }
    };
    if ctx.offer.status == OfferStatus::Paused || ctx.offer.adapter == OfferAdapter::Manual {
        return Vec::new();
    }
    let Some(url) = ctx.offer.url.clone() else { return Vec::new() };
    let interval = scheduler::interval_minutes(&ctx.settings, ctx.offer.adapter);
    if let Some(host) = http::host_of(&url) {
        st.http.host_mark(&host, Instant::now());
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| fetch_and_classify(&st.http, &st.ml, &url))).unwrap_or(PollOutcome::Failure {
        kind: FailKind::Transient,
        message: "Erro interno ao ler a página da loja.".to_string(),
    });
    // só uma leitura bem-sucedida pode disparar aviso
    let is_success = matches!(outcome, PollOutcome::Success(_));
    let new_alerts = {
        let Ok(conn) = st.conn() else { return Vec::new() };
        let settings = db::load_settings(&conn);
        let before = if is_success { snapshot_for(&conn, &settings, Some(&ctx.offer.item_id)) } else { None };
        match db::apply_poll_outcome(&conn, offer_id, ctx.model_token.as_deref(), outcome, interval, Utc::now(), scheduler::rand01()) {
            Err(e) => {
                eprintln!("[compras] falha ao gravar resultado da consulta: {e}");
                Vec::new()
            }
            Ok(_) if is_success => run_eval(&conn, &settings, &ctx.offer.item_id, alerts::Trigger::Poll, before.as_ref()),
            Ok(_) => Vec::new(),
        }
    };
    emit_updated(app, Some(&ctx.offer.item_id));
    new_alerts
}

fn run_tick(app: &AppHandle, force: bool) {
    let Ok(st) = state(app) else { return };
    let due = {
        let Ok(conn) = st.conn() else { return };
        let settings = db::load_settings(&conn);
        if !settings.poll_enabled && !force {
            return;
        }
        match db::due_offers(&conn, &now_s()) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[compras] falha ao listar ofertas vencidas: {e}");
                return;
            }
        }
    };
    if due.is_empty() {
        update_status(app, &st, |s| {
            if s.running || s.queued != 0 {
                s.running = false;
                s.queued = 0;
            }
        });
        return;
    }
    let mut pending = due;
    // avisos do ciclo: notificados no fim (limite de toasts por ciclo), nunca com o banco travado
    let mut cycle_alerts: Vec<alerts::NewAlert> = Vec::new();
    update_status(app, &st, |s| {
        s.running = true;
        s.queued = pending.len() as i64;
    });
    while !pending.is_empty() {
        let now = Instant::now();
        let mut pick: Option<usize> = None;
        let mut min_wait: Option<Duration> = None;
        for (idx, (_, url)) in pending.iter().enumerate() {
            let host = http::host_of(url).unwrap_or_default();
            let wait = st.http.host_wait(&host, now);
            if wait.is_zero() {
                pick = Some(idx);
                break;
            }
            min_wait = Some(min_wait.map_or(wait, |m| m.min(wait)));
        }
        match pick {
            Some(idx) => {
                let (id, _) = pending.remove(idx);
                match catch_unwind(AssertUnwindSafe(|| poll_one(app, &id))) {
                    Ok(a) => cycle_alerts.extend(a),
                    Err(_) => eprintln!("[compras] pânico contido ao consultar a oferta {id}"),
                }
            }
            None => std::thread::sleep(min_wait.unwrap_or(Duration::from_secs(1)).min(http::HOST_GAP)),
        }
        let left = pending.len() as i64;
        update_status(app, &st, |s| s.queued = left);
    }
    update_status(app, &st, |s| {
        s.running = false;
        s.queued = 0;
        s.last_run_at = Some(now_s());
    });
    dispatch(app, cycle_alerts);
}

/// Thread própria: acorda a cada 60 s (ou por `compras_refresh`) e consulta as ofertas vencidas.
pub fn spawn_ticker(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let mut force = false;
        loop {
            if catch_unwind(AssertUnwindSafe(|| run_tick(&app, force))).is_err() {
                eprintln!("[compras] pânico contido no ciclo do agendador");
                update_status_safe(&app);
            }
            if catch_unwind(AssertUnwindSafe(|| flush_pending(&app))).is_err() {
                eprintln!("[compras] pânico contido ao entregar avisos pendentes");
            }
            let Some(st) = app.try_state::<ComprasState>() else {
                std::thread::sleep(Duration::from_secs(60));
                continue;
            };
            force = wait_for_wake(&st, Duration::from_secs(60));
        }
    });
}

fn update_status_safe(app: &AppHandle) {
    if let Some(st) = app.try_state::<ComprasState>() {
        update_status(app, &st, |s| {
            s.running = false;
            s.queued = 0;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KABUM: &str = include_str!("../../tests/fixtures/compras/kabum.html");

    #[test]
    fn preview_ok_and_blocked_and_error() {
        let e = preview_from_response(200, KABUM, "https://www.kabum.com.br/produto/621162/x").unwrap();
        assert_eq!(e.cash_cents, Some(114999));
        let blocked = preview_from_response(403, "<html></html>", "https://www.amazon.com.br/dp/B0FZCT7GGZ").unwrap();
        assert!(blocked.blocked);
        assert!(preview_from_response(404, "<html></html>", "https://loja.exemplo.com/x").is_err());
    }

    #[test]
    fn csv_export_escapes_and_formats() {
        let c = db::open_memory().unwrap();
        let it = db::upsert_item(
            &c,
            ComprasItem {
                id: String::new(),
                category: "Eletros".into(),
                name: "Coifa; \"inox\"".into(),
                qty: 2,
                budget_unit_cents: Some(250000),
                target_cents: Some(199900),
                notes: String::new(),
                bought: false,
                image_path: None,
                specs: Default::default(),
                template_id: None,
                model_token: None,
                priority: 1,
                created_at: String::new(),
                updated_at: String::new(),
                room: None,
                archived: false,
            },
            "2026-11-05T12:00:00Z",
        )
        .unwrap();
        let views = db::load_views(&c, Some(&it.id), &ComprasSettings::default(), NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(), FixedOffset::east_opt(0).unwrap(), std::path::Path::new(".")).unwrap();
        let (csv, rows) = export_csv(&views);
        assert_eq!(rows, 1);
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("\"Coifa; \"\"inox\"\"\""));
        assert!(csv.contains(";2;2500,00;5000,00;"));
        assert!(csv.contains("1999,00"));
    }

    #[test]
    fn finish_preview_resolves_short_links_and_blocked_redirect() {
        let e = finish_preview(Extracted { list_cents: Some(34314), ..Default::default() }, "https://a.co/d/01KKEk0a", "https://www.amazon.com.br/dp/B0FZCT7GGZ?ref=x");
        assert_eq!(e.url, "https://www.amazon.com.br/dp/B0FZCT7GGZ?ref=x");
        assert_eq!(e.adapter, OfferAdapter::Amazon);
        assert_eq!(e.store, "Amazon");
        let g = finish_preview(Extracted::default(), "https://www.lg.com/br/x", "https://www.lg.com/br/x?y");
        assert_eq!(g.url, "https://www.lg.com/br/x");
        assert_eq!(g.adapter, OfferAdapter::Generic);
        let b = blocked_preview("https://www.mercadolivre.com.br/x");
        assert!(b.blocked && b.list_cents.is_none());
    }
}
