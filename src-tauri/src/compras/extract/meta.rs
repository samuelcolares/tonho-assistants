//! Meta tags (og:*, product:price:*, itemprop=price) e <title>.

use super::{first_attr_of, first_text_of};
use crate::compras::model::Extracted;
use crate::compras::money::cents_from_json;
use scraper::Html;
use serde_json::Value;

pub fn extract(doc: &Html) -> Extracted {
    let title = first_attr_of(doc, "meta[property=\"og:title\"]", "content")
        .or_else(|| first_attr_of(doc, "meta[name=\"twitter:title\"]", "content"))
        .or_else(|| first_text_of(doc, "title"));
    let image = first_attr_of(doc, "meta[property=\"og:image\"]", "content")
        .or_else(|| first_attr_of(doc, "meta[name=\"twitter:image\"]", "content"));
    let price_raw = first_attr_of(doc, "meta[property=\"product:price:amount\"]", "content")
        .or_else(|| first_attr_of(doc, "meta[property=\"og:price:amount\"]", "content"))
        .or_else(|| first_attr_of(doc, "meta[itemprop=\"price\"]", "content"));
    let price = price_raw.and_then(|p| cents_from_json(&Value::String(p)));
    let stock = first_attr_of(doc, "meta[property=\"product:availability\"]", "content").and_then(|a| {
        let l = a.to_lowercase();
        if l.contains("out of stock") || l.contains("oos") {
            Some(false)
        } else if l.contains("in stock") || l.contains("instock") {
            Some(true)
        } else {
            None
        }
    });
    Extracted { title, image_url: image, list_cents: price, in_stock: stock, ..Default::default() }
}
