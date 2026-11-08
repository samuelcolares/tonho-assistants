//! Backup e restauração do banco de Compras.
//!
//! Backup = `VACUUM INTO` num arquivo temporário vizinho + renomear (nunca deixa um arquivo pela metade no destino).
//! Restauração = valida o arquivo (somente leitura), guarda uma cópia do estado atual (`VACUUM INTO`) e só então
//! copia o backup para dentro da conexão viva com a API de backup do SQLite (uma única transação de escrita no
//! destino: se falhar no meio, o banco atual continua como estava).

use super::db::{self, dberr};
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OpenFlags};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

const NOT_A_BACKUP: &str = "O arquivo escolhido não é um backup de Compras.";

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name: OsString = path.file_name().map(|n| n.to_os_string()).unwrap_or_else(|| OsString::from("compras.db"));
    name.push(suffix);
    path.with_file_name(name)
}

/// Grava uma cópia consistente do banco em `dest` (sobrescreve se já existir). Devolve o caminho gravado.
pub fn backup_to(conn: &Connection, dest: &Path) -> Result<PathBuf, String> {
    if dest.as_os_str().is_empty() || dest.is_dir() {
        return Err("Escolha um nome de arquivo para o backup.".to_string());
    }
    if let Some(live) = db::db_file_path(conn) {
        if same_file(&live, dest) {
            return Err("Não é possível gravar o backup por cima do próprio banco de dados.".to_string());
        }
    }
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Err("A pasta escolhida para o backup não existe.".to_string());
        }
    }
    let tmp = with_suffix(dest, ".tmp");
    let _ = std::fs::remove_file(&tmp);
    if let Err(e) = conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()]) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Não foi possível criar o backup: {e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, dest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Não foi possível gravar o backup em \"{}\": {e}", dest.display()));
    }
    Ok(dest.to_path_buf())
}

/// Abre o arquivo somente leitura e confere: é SQLite, é do Compras, versão <= atual, `integrity_check` = ok.
fn open_valid_backup(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err("O arquivo de backup não foi encontrado.".to_string());
    }
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|_| NOT_A_BACKUP.to_string())?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| format!("{NOT_A_BACKUP} (não é um banco de dados válido)"))?;
    if version > db::SCHEMA_VERSION {
        return Err("Esse backup é de uma versão mais nova do aplicativo. Atualize o app antes de restaurar.".to_string());
    }
    let tables: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('items','offers','observations','settings')",
            [],
            |r| r.get(0),
        )
        .map_err(|_| NOT_A_BACKUP.to_string())?;
    if version < 1 || tables != 4 {
        return Err(NOT_A_BACKUP.to_string());
    }
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "O backup está corrompido (a verificação de integridade falhou).".to_string())?;
    if integrity != "ok" {
        return Err("O backup está corrompido (a verificação de integridade falhou).".to_string());
    }
    Ok(c)
}

fn copy_into(src: &Connection, dst: &mut Connection) -> Result<(), String> {
    let b = Backup::new(src, dst).map_err(dberr)?;
    b.run_to_completion(256, Duration::from_millis(0), None)
        .map_err(|e| format!("Não foi possível copiar os dados do backup: {e}"))
}

/// Substitui o conteúdo de `conn` pelo do backup `src`. Antes, grava o estado atual em `safety_bak`
/// (que não pode existir). Depois roda `migrate` (backup de versão antiga é atualizado).
/// Qualquer falha antes da cópia deixa o banco atual intocado.
pub fn restore_from(conn: &mut Connection, src: &Path, safety_bak: &Path) -> Result<(), String> {
    if let Some(live) = db::db_file_path(conn) {
        if same_file(&live, src) {
            return Err("Esse é o próprio banco de dados em uso. Escolha um arquivo de backup.".to_string());
        }
    }
    let s = open_valid_backup(src)?;
    if safety_bak.exists() {
        return Err("Já existe um arquivo com o nome da cópia de segurança.".to_string());
    }
    conn.execute("VACUUM INTO ?1", params![safety_bak.to_string_lossy()])
        .map_err(|e| format!("Não foi possível guardar o estado atual antes de restaurar (nada foi alterado): {e}"))?;
    copy_into(&s, conn)?;
    drop(s);
    if let Err(e) = db::migrate(conn) {
        // não deixa o app num estado meio-restaurado: volta ao que havia antes
        let back = Connection::open_with_flags(safety_bak, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(dberr)
            .and_then(|b| copy_into(&b, conn));
        return Err(match back {
            Ok(()) => format!("Não foi possível usar esse backup (os dados atuais foram mantidos): {e}"),
            Err(e2) => format!("Falha ao restaurar: {e}. Os dados anteriores estão em \"{}\" ({e2})", safety_bak.display()),
        });
    }
    Ok(())
}

/// `<dir>/compras.db.bak-restore-yyyymmddHHMMSS`, com sufixo numérico se já existir.
pub fn safety_backup_path(dir: &Path) -> PathBuf {
    let stamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let mut target = dir.join(format!("compras.db.bak-restore-{stamp}"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("compras.db.bak-restore-{stamp}-{n}"));
        n += 1;
    }
    target
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-11-05T12:00:00Z";

    fn add_item(c: &Connection, name: &str) -> String {
        let it = db::upsert_item(
            c,
            super::super::model::ComprasItem {
                id: String::new(),
                category: "Eletros".into(),
                name: name.into(),
                qty: 1,
                budget_unit_cents: Some(100_000),
                target_cents: Some(80_000),
                notes: String::new(),
                bought: false,
                image_path: None,
                specs: Default::default(),
                template_id: None,
                model_token: None,
                priority: 1,
                created_at: String::new(),
                updated_at: String::new(),
                room: Some("Sala".into()),
                archived: false,
            },
            NOW,
        )
        .unwrap();
        it.id
    }

    fn dump(c: &Connection) -> String {
        let mut out = String::new();
        for (t, order) in [("items", "id"), ("offers", "id"), ("observations", "id"), ("alert_rules", "item_id"), ("settings", "key")] {
            let mut st = c.prepare(&format!("SELECT * FROM {t} ORDER BY {order}")).unwrap();
            let n = st.column_count();
            let rows = st
                .query_map([], |r| {
                    let mut cells = Vec::new();
                    for i in 0..n {
                        let v: rusqlite::types::Value = r.get(i)?;
                        cells.push(format!("{v:?}"));
                    }
                    Ok(cells.join("|"))
                })
                .unwrap();
            out.push_str(&format!("[{t}]\n"));
            for r in rows {
                out.push_str(&r.unwrap());
                out.push('\n');
            }
        }
        out
    }

    fn version(c: &Connection) -> i64 {
        c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    fn names(c: &Connection) -> Vec<String> {
        let mut st = c.prepare("SELECT name FROM items ORDER BY name").unwrap();
        let v = st.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect();
        v
    }

    #[test]
    fn backup_round_trip_is_identical_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let live = db::open_file(&dir.path().join("compras.db")).unwrap();
        add_item(&live, "Geladeira");
        add_item(&live, "Cooktop");
        db::save_settings(&live, super::super::model::ComprasSettings { cooldown_hours: 48, rooms: vec!["Sala".into()], ..Default::default() }).unwrap();
        let dest = dir.path().join("meu-backup.db");
        // sobrescrever um arquivo existente também funciona
        std::fs::write(&dest, b"lixo antigo").unwrap();
        let out = backup_to(&live, &dest).unwrap();
        assert_eq!(out, dest);
        assert!(!dir.path().join("meu-backup.db.tmp").exists());
        let copy = Connection::open_with_flags(&dest, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(version(&copy), db::SCHEMA_VERSION);
        assert_eq!(dump(&copy), dump(&live));
        assert_eq!(db::load_settings(&copy).cooldown_hours, 48);
    }

    #[test]
    fn backup_refuses_the_live_db_and_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("compras.db");
        let live = db::open_file(&path).unwrap();
        assert!(backup_to(&live, &path).unwrap_err().contains("próprio banco"));
        assert!(backup_to(&live, &dir.path().join("nao-existe").join("b.db")).is_err());
        assert_eq!(version(&live), db::SCHEMA_VERSION);
    }

    #[test]
    fn restore_replaces_data_and_keeps_a_bak_of_the_previous_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = db::open_file(&dir.path().join("compras.db")).unwrap();
        add_item(&live, "Geladeira");
        let backup = dir.path().join("b.db");
        backup_to(&live, &backup).unwrap();
        let snapshot = dump(&live);
        add_item(&live, "Item novo depois do backup");
        assert_eq!(names(&live).len(), 2);

        let bak = dir.path().join("antes.bak");
        restore_from(&mut live, &backup, &bak).unwrap();
        assert_eq!(dump(&live), snapshot);
        assert_eq!(version(&live), db::SCHEMA_VERSION);
        // a conexão continua gravável
        add_item(&live, "Depois da restauração");
        assert_eq!(names(&live).len(), 2);
        // o .bak guarda o estado de antes (com o item novo)
        let b = Connection::open_with_flags(&bak, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(names(&b), vec!["Geladeira".to_string(), "Item novo depois do backup".to_string()]);
        // o arquivo em disco também reflete a restauração
        drop(live);
        let reopened = db::open_file(&dir.path().join("compras.db")).unwrap();
        assert_eq!(names(&reopened), vec!["Depois da restauração".to_string(), "Geladeira".to_string()]);
    }

    #[test]
    fn restore_rejects_newer_version_without_touching_anything() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = db::open_file(&dir.path().join("compras.db")).unwrap();
        add_item(&live, "Geladeira");
        let before = dump(&live);
        let newer = dir.path().join("novo.db");
        backup_to(&live, &newer).unwrap();
        Connection::open(&newer).unwrap().pragma_update(None, "user_version", db::SCHEMA_VERSION + 1).unwrap();
        let bak = dir.path().join("antes.bak");
        let err = restore_from(&mut live, &newer, &bak).unwrap_err();
        assert!(err.contains("mais nova"), "{err}");
        assert!(!bak.exists());
        assert_eq!(dump(&live), before);
    }

    #[test]
    fn restore_rejects_non_db_missing_and_foreign_sqlite_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = db::open_file(&dir.path().join("compras.db")).unwrap();
        add_item(&live, "Geladeira");
        let before = dump(&live);
        let bak = dir.path().join("antes.bak");

        let garbage = dir.path().join("lixo.db");
        std::fs::write(&garbage, vec![7u8; 5000]).unwrap();
        assert!(restore_from(&mut live, &garbage, &bak).unwrap_err().contains("não é um backup"));

        let text = dir.path().join("nota.txt");
        std::fs::write(&text, "oi").unwrap();
        assert!(restore_from(&mut live, &text, &bak).is_err());

        assert!(restore_from(&mut live, &dir.path().join("nada.db"), &bak).unwrap_err().contains("não foi encontrado"));

        // SQLite válido, mas de outro programa
        let foreign = dir.path().join("outro.db");
        {
            let f = Connection::open(&foreign).unwrap();
            f.execute_batch("CREATE TABLE foo(x); PRAGMA user_version = 1;").unwrap();
        }
        assert!(restore_from(&mut live, &foreign, &bak).unwrap_err().contains("não é um backup"));

        assert!(!bak.exists());
        assert_eq!(dump(&live), before);
    }

    #[test]
    fn restore_refuses_the_live_file_and_an_existing_bak_name() {
        let dir = tempfile::tempdir().unwrap();
        let live_path = dir.path().join("compras.db");
        let mut live = db::open_file(&live_path).unwrap();
        let bak = dir.path().join("antes.bak");
        assert!(restore_from(&mut live, &live_path, &bak).unwrap_err().contains("próprio banco"));
        let other = dir.path().join("b.db");
        backup_to(&live, &other).unwrap();
        std::fs::write(&bak, b"x").unwrap();
        assert!(restore_from(&mut live, &other, &bak).is_err());
        assert_eq!(std::fs::read(&bak).unwrap(), b"x");
    }

    #[test]
    fn restore_of_an_older_version_migrates_it() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("v1.db");
        {
            let c = Connection::open(&old).unwrap();
            c.execute_batch(db::SCHEMA_V1).unwrap();
            c.pragma_update(None, "user_version", 1).unwrap();
            c.execute(
                "INSERT INTO items(id, category, name, qty, budget_unit_cents, target_cents, notes, bought, specs, priority, created_at, updated_at)
                 VALUES ('i1','Eletros','Geladeira antiga',1,300000,250000,'',0,'{}',1,?1,?1)",
                params![NOW],
            )
            .unwrap();
        }
        let mut live = db::open_file(&dir.path().join("compras.db")).unwrap();
        add_item(&live, "Atual");
        restore_from(&mut live, &old, &dir.path().join("antes.bak")).unwrap();
        assert_eq!(version(&live), db::SCHEMA_VERSION);
        assert_eq!(names(&live), vec!["Geladeira antiga".to_string()]);
        let rules: i64 = live.query_row("SELECT COUNT(*) FROM alert_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(rules, 1, "regra de aviso criada pela migração");
    }

    #[test]
    fn safety_backup_names_do_not_collide() {
        let dir = tempfile::tempdir().unwrap();
        let a = safety_backup_path(dir.path());
        std::fs::write(&a, b"x").unwrap();
        let b = safety_backup_path(dir.path());
        assert_ne!(a, b);
        assert!(b.file_name().unwrap().to_string_lossy().starts_with("compras.db.bak-restore-"));
    }
}
