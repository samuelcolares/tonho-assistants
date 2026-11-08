//! Importação da planilha "Compras para Casa" (aba `Produtos`) com `calamine`.
//! O mapeamento trabalha sobre `Vec<Vec<Cell>>` para ser testável sem arquivo.

use super::db::{self, SheetItem};
use super::model::ImportReport;
use super::templates::fold;
use calamine::{open_workbook_auto, Data, Reader};
use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Empty,
    Text(String),
    Num(f64),
    Bool(bool),
}

impl Cell {
    fn text(&self) -> String {
        match self {
            Cell::Text(s) => s.trim().to_string(),
            Cell::Num(n) => {
                if n.fract() == 0.0 {
                    format!("{}", *n as i64)
                } else {
                    n.to_string()
                }
            }
            Cell::Bool(b) => b.to_string(),
            Cell::Empty => String::new(),
        }
    }
}

fn from_data(d: &Data) -> Cell {
    match d {
        Data::Empty => Cell::Empty,
        Data::String(s) => Cell::Text(s.clone()),
        Data::Float(f) => Cell::Num(*f),
        Data::Int(i) => Cell::Num(*i as f64),
        Data::Bool(b) => Cell::Bool(*b),
        Data::DateTime(_) | Data::DateTimeIso(_) | Data::DurationIso(_) => Cell::Text(d.to_string()),
        Data::Error(_) => Cell::Empty,
    }
}

#[derive(Debug, Default)]
struct Columns {
    bought: Option<usize>,
    category: Option<usize>,
    item: Option<usize>,
    qty: Option<usize>,
    price: Option<usize>,
    notes: Option<usize>,
}

fn detect_columns(row: &[Cell]) -> Option<Columns> {
    let mut c = Columns::default();
    for (i, cell) in row.iter().enumerate() {
        let h = fold(&cell.text());
        match h.as_str() {
            "comprado" => c.bought = Some(i),
            "categoria" => c.category = Some(i),
            "item" => c.item = Some(i),
            "qtd" | "quantidade" | "qtde" => c.qty = Some(i),
            "total" | "aux" => {}
            h if h.starts_with("preco") => c.price = c.price.or(Some(i)),
            h if h.starts_with("observ") => c.notes = Some(i),
            _ => {}
        }
    }
    // cabeçalho válido: tem Item e pelo menos Comprado ou Categoria
    if c.item.is_some() && (c.bought.is_some() || c.category.is_some()) {
        Some(c)
    } else {
        None
    }
}

fn get<'a>(row: &'a [Cell], idx: Option<usize>) -> &'a Cell {
    static EMPTY: Cell = Cell::Empty;
    idx.and_then(|i| row.get(i)).unwrap_or(&EMPTY)
}

fn to_cents(c: &Cell) -> Result<Option<i64>, String> {
    match c {
        Cell::Empty => Ok(None),
        Cell::Num(n) if n.is_finite() && *n >= 0.0 => Ok(Some((n * 100.0).round() as i64)),
        Cell::Num(_) => Err("valor inválido".to_string()),
        Cell::Text(t) if t.trim().is_empty() => Ok(None),
        Cell::Text(t) => super::money::parse_brl(t).map(Some).ok_or_else(|| format!("valor inválido \"{t}\"")),
        Cell::Bool(_) => Err("valor inválido".to_string()),
    }
}

/// Mapeia as linhas da aba para itens. Cabeçalho = linha com Comprado/Categoria/Item;
/// dados até a primeira linha com Item vazio.
pub fn map_rows(rows: &[Vec<Cell>]) -> Result<(Vec<SheetItem>, Vec<String>), String> {
    let (header_idx, cols) = rows
        .iter()
        .enumerate()
        .find_map(|(i, r)| detect_columns(r).map(|c| (i, c)))
        .ok_or_else(|| "Não encontrei a linha de cabeçalho (Comprado / Categoria / Item) na aba Produtos.".to_string())?;
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for (offset, row) in rows.iter().enumerate().skip(header_idx + 1) {
        let line = offset + 1;
        let name = get(row, cols.item).text();
        if name.is_empty() {
            break;
        }
        let category = {
            let c = get(row, cols.category).text();
            if c.is_empty() {
                "Geral".to_string()
            } else {
                c
            }
        };
        let bought = fold(&get(row, cols.bought).text()) == "sim";
        let qty = match get(row, cols.qty) {
            Cell::Num(n) if n.is_finite() && *n >= 0.0 => n.round() as i64,
            Cell::Empty => 1,
            other => {
                let t = other.text();
                match t.parse::<f64>() {
                    Ok(n) if n.is_finite() && n >= 0.0 => n.round() as i64,
                    _ => {
                        errors.push(format!("Linha {line}: quantidade inválida em \"{name}\"; usei 1."));
                        1
                    }
                }
            }
        };
        let budget = match to_cents(get(row, cols.price)) {
            Ok(v) => v,
            Err(e) => {
                errors.push(format!("Linha {line}: preço un. de \"{name}\": {e}."));
                None
            }
        };
        items.push(SheetItem { bought, category, name, qty, budget_unit_cents: budget, notes: get(row, cols.notes).text() });
    }
    if items.is_empty() {
        return Err("A aba Produtos não tem itens abaixo do cabeçalho.".to_string());
    }
    Ok((items, errors))
}

pub fn read_rows(path: &str) -> Result<Vec<Vec<Cell>>, String> {
    if !std::path::Path::new(path).is_file() {
        return Err("Arquivo da planilha não encontrado.".to_string());
    }
    let mut wb = open_workbook_auto(path).map_err(|e| format!("Não foi possível abrir a planilha: {e}"))?;
    let names = wb.sheet_names();
    let sheet = names
        .iter()
        .find(|n| fold(n) == "produtos")
        .or_else(|| names.first())
        .cloned()
        .ok_or_else(|| "A planilha não tem abas.".to_string())?;
    let range = wb.worksheet_range(&sheet).map_err(|e| format!("Não foi possível ler a aba \"{sheet}\": {e}"))?;
    Ok(range.rows().map(|r| r.iter().map(from_data).collect()).collect())
}

/// Importa a planilha inteira numa transação e devolve o relatório com os totais do banco.
pub fn import_file(conn: &Connection, path: &str, now: &str, compras_dir: &std::path::Path, today: chrono::NaiveDate, tz: chrono::FixedOffset) -> Result<ImportReport, String> {
    let rows = read_rows(path)?;
    let (items, errors) = map_rows(&rows)?;
    let report = ImportReport { errors, ..Default::default() };
    let mut report = db::import_items(conn, &items, now, report)?;
    let totals = db::totals(conn, compras_dir, today, tz)?;
    report.total_budget_cents = totals.total_budget_cents;
    report.bought_cents = totals.bought_cents;
    report.remaining_budget_cents = totals.remaining_budget_cents;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, NaiveDate};

    fn t(s: &str) -> Cell {
        Cell::Text(s.to_string())
    }
    fn n(v: f64) -> Cell {
        Cell::Num(v)
    }

    fn sheet() -> Vec<Vec<Cell>> {
        vec![
            vec![t("Lista de Compras — Nossa Casa")],
            vec![t("Comprado"), t("Categoria"), t("Item"), t("Qtd"), t("Preço un."), t("Total"), t("Observações"), t("aux")],
            vec![t("Sim"), t("Mão de Obra"), t("Alvenaria Deck"), n(1.0), n(39000.0), n(39000.0), Cell::Empty, n(0.0)],
            vec![t("Não"), t("Eletros"), t("Ar-condicionado - 24000 btus"), n(1.0), n(6281.0), n(6281.0), t("Black - LG 4975 no pix"), n(6281.000004)],
            vec![t("Não"), t("Enxoval"), t("Cabides"), n(3.0), n(75.9), n(227.7), Cell::Empty, n(1.0)],
            vec![t("Não"), t("Enxoval"), t("Luminárias"), n(0.0), n(1000.0), n(0.0), Cell::Empty, n(0.0)],
            vec![Cell::Empty, Cell::Empty, Cell::Empty, Cell::Empty, Cell::Empty, Cell::Empty, Cell::Empty, n(0.0)],
            vec![t("Não"), t("Enxoval"), t("Depois do vazio"), n(1.0), n(10.0)],
        ]
    }

    #[test]
    fn maps_header_rows_and_stops_at_empty_item() {
        let (items, errors) = map_rows(&sheet()).unwrap();
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(items.len(), 4);
        assert!(items[0].bought);
        assert_eq!(items[0].category, "Mão de Obra");
        assert_eq!(items[0].budget_unit_cents, Some(3_900_000));
        assert!(!items[1].bought);
        assert_eq!(items[1].notes, "Black - LG 4975 no pix");
        assert_eq!(items[2].budget_unit_cents, Some(7590));
        assert_eq!(items[2].qty, 3);
        assert_eq!(items[3].qty, 0);
    }

    #[test]
    fn missing_header_is_error() {
        assert!(map_rows(&[vec![t("a"), t("b")]]).is_err());
        assert!(map_rows(&[vec![t("Comprado"), t("Categoria"), t("Item")]]).is_err());
    }

    #[test]
    fn reports_bad_price_and_qty() {
        let rows = vec![
            vec![t("Comprado"), t("Categoria"), t("Item"), t("Qtd"), t("Preço un.")],
            vec![t("Não"), t("Eletros"), t("Coifa"), t("dois"), t("abc")],
            vec![t("Não"), t("Eletros"), t("Mixer"), Cell::Empty, t("R$ 1.299,90")],
        ];
        let (items, errors) = map_rows(&rows).unwrap();
        assert_eq!(errors.len(), 2);
        assert_eq!(items[0].qty, 1);
        assert_eq!(items[0].budget_unit_cents, None);
        assert_eq!(items[1].budget_unit_cents, Some(129990));
    }

    #[test]
    fn totals_from_mapped_rows_via_db() {
        let (items, _) = map_rows(&sheet()).unwrap();
        let conn = db::open_memory().unwrap();
        let r = db::import_items(&conn, &items, "2026-11-05T12:00:00Z", ImportReport::default()).unwrap();
        assert_eq!(r.inserted, 4);
        let s = db::totals(&conn, std::path::Path::new("."), NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(), FixedOffset::east_opt(0).unwrap()).unwrap();
        assert_eq!(s.total_budget_cents, 3_900_000 + 628_100 + 3 * 7590 + 0);
        assert_eq!(s.bought_cents, 3_900_000);
    }

    /// Usa o arquivo real do usuário; rodar com `cargo test -- --ignored compras`.
    #[test]
    #[ignore]
    fn real_xlsx_import_matches_sheet_totals() {
        let path = r"C:\Users\krieg\Downloads\Compras para Casa .xlsx";
        let conn = db::open_memory().unwrap();
        let tz = FixedOffset::east_opt(0).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 11, 5).unwrap();
        let report = import_file(&conn, path, "2026-11-05T12:00:00Z", std::path::Path::new("."), today, tz).unwrap();
        println!("import report: {report:?}");
        assert_eq!(report.inserted, 80);
        assert_eq!(report.bought_imported, 8);
        assert_eq!(report.total_budget_cents, 10_618_770);
        assert_eq!(report.bought_cents, 4_239_000);
        assert_eq!(report.remaining_budget_cents, 6_379_770);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        // idempotente
        let again = import_file(&conn, path, "2026-11-06T12:00:00Z", std::path::Path::new("."), today, tz).unwrap();
        assert_eq!((again.inserted, again.updated, again.bought_imported), (0, 80, 0));
        assert_eq!(again.total_budget_cents, 10_618_770);
        let s = db::totals(&conn, std::path::Path::new("."), today, tz).unwrap();
        assert_eq!((s.items_total, s.items_bought), (80, 8));
    }
}
