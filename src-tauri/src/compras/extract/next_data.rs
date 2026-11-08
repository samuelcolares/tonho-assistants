//! `__NEXT_DATA__` (Next.js): leitura e heurística genérica de produto.

use super::sel;
use crate::compras::model::Extracted;
use crate::compras::money::cents_from_json;
use scraper::Html;
use serde_json::Value;
use std::collections::VecDeque;

pub fn find(doc: &Html) -> Option<Value> {
    let s = sel("script#__NEXT_DATA__")?;
    let el = doc.select(&s).next()?;
    let raw: String = el.text().collect();
    serde_json::from_str(raw.trim()).ok()
}

const LIST_KEYS: &[&str] = &["price", "salePrice", "sellingPrice", "currentPrice", "bestPrice"];
const CASH_KEYS: &[&str] = &["priceWithDiscount", "pixPrice", "cashPrice", "priceCash", "pricePix"];
const NAME_KEYS: &[&str] = &["name", "title"];
const IMAGE_KEYS: &[&str] = &["image", "imageUrl", "thumbnail"];

fn str_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn bool_of(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.to_lowercase().as_str() {
            "true" | "instock" | "available" => Some(true),
            "false" | "outofstock" | "unavailable" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Procura (em largura) o objeto mais raso com nome + preço plausível.
pub fn heuristic(root: &Value) -> Option<Extracted> {
    let mut queue: VecDeque<(&Value, usize)> = VecDeque::new();
    queue.push_back((root, 0));
    let mut visited = 0usize;
    while let Some((v, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 200_000 || depth > 14 {
            break;
        }
        match v {
            Value::Object(map) => {
                let name = NAME_KEYS
                    .iter()
                    .find_map(|k| map.get(*k).and_then(|x| x.as_str()))
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty());
                let list = LIST_KEYS.iter().find_map(|k| map.get(*k).and_then(cents_from_json));
                let cash = CASH_KEYS.iter().find_map(|k| map.get(*k).and_then(cents_from_json));
                if let (Some(name), true) = (name, list.is_some() || cash.is_some()) {
                    let cash = match (list, cash) {
                        (Some(l), Some(c)) if c >= l => None,
                        (_, c) => c,
                    };
                    return Some(Extracted {
                        title: Some(name.to_string()),
                        list_cents: list,
                        cash_cents: cash,
                        image_url: IMAGE_KEYS
                            .iter()
                            .find_map(|k| map.get(*k).and_then(|x| x.as_str()))
                            .map(|s| s.to_string())
                            .filter(|s| s.starts_with("http") || s.starts_with("//")),
                        in_stock: ["available", "inStock", "isAvailable", "availability"].iter().find_map(|k| map.get(*k).and_then(bool_of)),
                        sku: map.get("sku").and_then(str_of),
                        ..Default::default()
                    });
                }
                for child in map.values() {
                    queue.push_back((child, depth + 1));
                }
            }
            Value::Array(a) => {
                for child in a {
                    queue.push_back((child, depth + 1));
                }
            }
            _ => {}
        }
    }
    None
}
