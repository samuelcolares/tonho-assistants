//! JSON-LD (schema.org Product/Offer/AggregateOffer).

use super::sel;
use crate::compras::model::Extracted;
use crate::compras::money::cents_from_json;
use scraper::Html;
use serde_json::Value;

fn type_has(v: &Value, name: &str) -> bool {
    match v.get("@type") {
        Some(Value::String(s)) => s.eq_ignore_ascii_case(name),
        Some(Value::Array(a)) => a.iter().any(|t| t.as_str().map(|s| s.eq_ignore_ascii_case(name)).unwrap_or(false)),
        _ => false,
    }
}

fn collect_products(v: &Value, out: &mut Vec<Value>, depth: usize) {
    if depth > 6 {
        return;
    }
    match v {
        Value::Array(a) => a.iter().for_each(|x| collect_products(x, out, depth + 1)),
        Value::Object(_) => {
            if let Some(g) = v.get("@graph") {
                collect_products(g, out, depth + 1);
            }
            if type_has(v, "Product") {
                out.push(v.clone());
            }
        }
        _ => {}
    }
}

/// Todos os Product encontrados nos blocos ld+json da página.
pub fn products(doc: &Html) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(s) = sel("script[type*=\"ld+json\"]") else {
        return out;
    };
    for el in doc.select(&s) {
        let raw: String = el.text().collect();
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            collect_products(&v, &mut out, 0);
        }
    }
    out
}

fn availability(v: &Value) -> Option<bool> {
    let s = v.as_str()?;
    let l = s.to_lowercase();
    if l.contains("outofstock") || l.contains("soldout") || l.contains("discontinued") {
        Some(false)
    } else if l.contains("instock") || l.contains("limitedavailability") || l.contains("onlineonly") {
        Some(true)
    } else {
        None
    }
}

fn spec_price(v: &Value) -> Option<i64> {
    match v.get("priceSpecification") {
        Some(Value::Object(_)) => v["priceSpecification"].get("price").and_then(cents_from_json),
        Some(Value::Array(a)) => a.iter().filter_map(|p| p.get("price").and_then(cents_from_json)).min(),
        _ => None,
    }
}

/// (menor preço, disponibilidade) a partir de `offers`.
pub fn offer_info(offers: &Value, depth: usize) -> (Option<i64>, Option<bool>) {
    if depth > 4 {
        return (None, None);
    }
    match offers {
        Value::Array(a) => {
            let mut price: Option<i64> = None;
            let mut stock: Option<bool> = None;
            for o in a {
                let (p, s) = offer_info(o, depth + 1);
                if let Some(p) = p {
                    price = Some(price.map_or(p, |x| x.min(p)));
                }
                stock = match (stock, s) {
                    (Some(true), _) | (_, Some(true)) => Some(true),
                    (Some(false), _) | (_, Some(false)) => Some(false),
                    _ => None,
                };
            }
            (price, stock)
        }
        Value::Object(_) => {
            let stock = offers.get("availability").and_then(availability);
            let price = if type_has(offers, "AggregateOffer") {
                offers
                    .get("lowPrice")
                    .and_then(cents_from_json)
                    .or_else(|| offers.get("offers").and_then(|n| offer_info(n, depth + 1).0))
                    .or_else(|| offers.get("price").and_then(cents_from_json))
            } else {
                offers
                    .get("price")
                    .and_then(cents_from_json)
                    .or_else(|| spec_price(offers))
                    .or_else(|| offers.get("lowPrice").and_then(cents_from_json))
            };
            (price, stock)
        }
        _ => (None, None),
    }
}

fn image_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Array(a) => a.iter().find_map(image_of),
        Value::Object(_) => v.get("url").and_then(image_of),
        _ => None,
    }
}

fn str_or_num(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Extrai do melhor Product: o primeiro com preço, senão o primeiro.
pub fn extract(doc: &Html) -> Option<Extracted> {
    let prods = products(doc);
    let chosen = prods
        .iter()
        .find(|p| p.get("offers").map(|o| offer_info(o, 0).0.is_some()).unwrap_or(false))
        .or_else(|| prods.first())?;
    let (price, stock) = chosen.get("offers").map(|o| offer_info(o, 0)).unwrap_or((None, None));
    Some(Extracted {
        title: chosen.get("name").and_then(|n| n.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        image_url: chosen.get("image").and_then(image_of),
        list_cents: price,
        in_stock: stock,
        sku: chosen.get("sku").and_then(str_or_num),
        ..Default::default()
    })
}
