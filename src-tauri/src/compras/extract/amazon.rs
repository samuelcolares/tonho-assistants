//! Amazon BR: HTML estático (#productTitle, bloco de preço, hiRes) + detecção de captcha.

use super::{first_attr_of, first_text_of, sel};
use crate::compras::model::Extracted;
use crate::compras::money::parse_brl;
use crate::compras::templates::fold;
use scraper::Html;

pub fn is_captcha(html: &str) -> bool {
    html.contains("/errors/validateCaptcha")
        || html.contains("Digite os caracteres que voc")
        || html.contains("Enter the characters you see below")
        || html.contains("api-services-support@amazon.com")
        || (html.contains("Robot Check") && !html.contains("id=\"productTitle\""))
}

const PRICE_SELECTORS: &[&str] = &[
    "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen",
    "#apex_desktop .a-price:not(.a-text-price) .a-offscreen",
    ".priceToPay .a-offscreen",
    ".apex-pricetopay-value .a-offscreen",
    "#price_inside_buybox",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
];

fn price_of(doc: &Html) -> Option<i64> {
    for css in PRICE_SELECTORS {
        let Some(s) = sel(css) else { continue };
        for el in doc.select(&s) {
            let text: String = el.text().collect();
            if let Some(c) = parse_brl(&text) {
                return Some(c);
            }
        }
    }
    None
}

/// `"hiRes":"https://..."` (ignora `"hiRes":null`).
fn hires_image(html: &str) -> Option<String> {
    let mut rest = html;
    while let Some(i) = rest.find("\"hiRes\":\"") {
        let after = &rest[i + 9..];
        let end = after.find('"')?;
        let url = &after[..end];
        if url.starts_with("http") {
            return Some(url.to_string());
        }
        rest = &after[end..];
    }
    None
}

fn asin_from_url(url: &str) -> Option<String> {
    for marker in ["/dp/", "/gp/product/"] {
        if let Some(i) = url.find(marker) {
            let tail = &url[i + marker.len()..];
            let asin: String = tail.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            if asin.len() == 10 {
                return Some(asin);
            }
        }
    }
    None
}

pub fn extract(doc: &Html, html: &str, url: &str) -> Option<Extracted> {
    let title = first_text_of(doc, "#productTitle");
    let price = price_of(doc);
    if title.is_none() && price.is_none() {
        return None;
    }
    let image = hires_image(html)
        .or_else(|| first_attr_of(doc, "#landingImage", "data-old-hires").filter(|s| s.starts_with("http")))
        .or_else(|| first_attr_of(doc, "#landingImage", "src").filter(|s| s.starts_with("http")));
    let availability = first_text_of(doc, "#availability").map(|t| fold(&t));
    let out_of_stock_el = sel("#outOfStock").map(|s| doc.select(&s).next().is_some()).unwrap_or(false);
    let in_stock = match availability.as_deref() {
        Some(a) if a.contains("indisponivel") || a.contains("naodisponivel") || a.contains("currentlyunavailable") => Some(false),
        Some(a) if a.contains("emestoque") || a.contains("instock") => Some(true),
        _ if out_of_stock_el => Some(false),
        _ => None,
    };
    let sku = first_attr_of(doc, "input#ASIN", "value").or_else(|| asin_from_url(url));
    Some(Extracted { title, image_url: image, list_cents: price, in_stock, sku, ..Default::default() })
}
