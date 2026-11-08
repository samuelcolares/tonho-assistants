//! KaBuM!: `__NEXT_DATA__` -> props.pageProps.product.
//! `prices.price` = preço de lista (cartão); `prices.priceWithDiscount` = Pix.

use super::next_data;
use crate::compras::model::Extracted;
use crate::compras::money::{cents_from_json, format_installments};
use scraper::Html;
use serde_json::Value;

fn truthy(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub fn extract(doc: &Html) -> Option<Extracted> {
    let nd = next_data::find(doc)?;
    let p = nd.pointer("/props/pageProps/product")?;
    let list = p.pointer("/prices/price").and_then(cents_from_json).or_else(|| p.get("price").and_then(cents_from_json));
    let cash = p.pointer("/prices/priceWithDiscount").and_then(cents_from_json);
    let installments = {
        let n = p.pointer("/installment/installment").and_then(|v| v.as_i64());
        let amt = p.pointer("/installment/amount").and_then(cents_from_json);
        match (n, amt) {
            (Some(n), Some(a)) if n >= 2 => Some(format_installments(n, a)),
            _ => None,
        }
    };
    let image = p
        .get("medias")
        .and_then(|m| m.as_array())
        .and_then(|a| a.iter().find_map(|m| m.pointer("/images/g").and_then(|v| v.as_str())))
        .map(|s| s.to_string());
    Some(Extracted {
        title: p.get("title").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        image_url: image,
        list_cents: list,
        cash_cents: cash,
        installments_text: installments,
        in_stock: p.get("available").and_then(truthy),
        sku: p.get("id").and_then(|v| match v {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }),
        ..Default::default()
    })
}
