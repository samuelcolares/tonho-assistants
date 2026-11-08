//! Extração de produto/preço a partir de HTML. Função pura: `extract(html, url)`.
//! Ordem: adaptador da loja -> JSON-LD -> `__NEXT_DATA__` (heurística) -> meta tags.

pub mod amazon;
pub mod jsonld;
pub mod kabum;
pub mod meta;
pub mod next_data;
pub mod vtex;

use super::model::{Extracted, OfferAdapter};
use super::templates::fold;
use scraper::{Html, Selector};

pub(crate) fn sel(css: &str) -> Option<Selector> {
    Selector::parse(css).ok()
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn first_text_of(doc: &Html, css: &str) -> Option<String> {
    let s = sel(css)?;
    let el = doc.select(&s).next()?;
    let t = collapse_ws(&el.text().collect::<String>());
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

pub(crate) fn first_attr_of(doc: &Html, css: &str, attr: &str) -> Option<String> {
    let s = sel(css)?;
    let el = doc.select(&s).next()?;
    let v = el.value().attr(attr)?;
    let t = collapse_ws(v);
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase()))
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Adaptador pelo domínio da URL.
pub fn detect_adapter(url: &str) -> OfferAdapter {
    let Some(h) = host_of(url) else {
        return OfferAdapter::Generic;
    };
    if host_matches(&h, "kabum.com.br") {
        OfferAdapter::Kabum
    } else if host_matches(&h, "amazon.com.br") || host_matches(&h, "amazon.com") {
        OfferAdapter::Amazon
    } else if ["samsclub.com.br", "fastshop.com.br", "carrefour.com.br", "myvtex.com", "vtexcommercestable.com.br"]
        .iter()
        .any(|d| host_matches(&h, d))
    {
        OfferAdapter::Vtex
    } else if host_matches(&h, "mercadolivre.com.br") {
        OfferAdapter::MercadoLivre
    } else {
        OfferAdapter::Generic
    }
}

/// Nome de exibição da loja a partir da URL.
pub fn store_name(url: &str) -> String {
    let Some(h) = host_of(url) else {
        return String::new();
    };
    let known: &[(&str, &str)] = &[
        ("kabum.com.br", "KaBuM"),
        ("amazon.com.br", "Amazon"),
        ("amazon.com", "Amazon"),
        ("samsclub.com.br", "Sam's Club"),
        ("fastshop.com.br", "Fast Shop"),
        ("carrefour.com.br", "Carrefour"),
        ("mercadolivre.com.br", "Mercado Livre"),
        ("magazineluiza.com.br", "Magalu"),
        ("casasbahia.com.br", "Casas Bahia"),
        ("leroymerlin.com.br", "Leroy Merlin"),
        ("zoom.com.br", "Zoom"),
    ];
    if let Some((_, n)) = known.iter().find(|(d, _)| host_matches(&h, d)) {
        return n.to_string();
    }
    let trimmed = h.strip_prefix("www.").unwrap_or(&h);
    let first = trimmed.split('.').next().unwrap_or(trimmed);
    let mut chars = first.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Marcadores de captcha/WAF (usados só quando nada foi extraído).
fn looks_blocked(html: &str) -> bool {
    amazon::is_captcha(html)
        || html.contains("captcha-delivery.com")
        || html.contains("Attention Required! | Cloudflare")
        || html.contains("cf-chl-")
        || html.contains("_Incapsula_Resource")
        || html.contains("px-captcha")
        || (html.contains("Access Denied") && html.contains("Reference #"))
}

fn resolve_url(base: &str, href: &str) -> Option<String> {
    if href.starts_with("data:") {
        return None;
    }
    let b = url::Url::parse(base).ok()?;
    let joined = b.join(href).ok()?;
    match joined.scheme() {
        "http" | "https" => Some(joined.to_string()),
        _ => None,
    }
}

fn has_price(e: &Extracted) -> bool {
    e.list_cents.is_some() || e.cash_cents.is_some()
}

/// Completa campos ausentes de `into` com `from`. Preços só entram como par.
fn fill(into: &mut Extracted, from: Extracted) {
    let from_has_price = has_price(&from);
    if into.title.is_none() {
        into.title = from.title;
    }
    if into.image_url.is_none() {
        into.image_url = from.image_url;
    }
    if into.sku.is_none() {
        into.sku = from.sku;
    }
    if into.in_stock.is_none() {
        into.in_stock = from.in_stock;
    }
    if !has_price(into) && from_has_price {
        into.list_cents = from.list_cents;
        into.cash_cents = from.cash_cents;
        if into.installments_text.is_none() {
            into.installments_text = from.installments_text;
        }
    }
}

pub fn extract(html: &str, url: &str) -> Extracted {
    let adapter = detect_adapter(url);
    let mut out = Extracted { url: url.to_string(), store: store_name(url), adapter, ..Default::default() };
    let doc = Html::parse_document(html);

    let specific = match adapter {
        OfferAdapter::Kabum => kabum::extract(&doc),
        OfferAdapter::Amazon => amazon::extract(&doc, html, url),
        OfferAdapter::Vtex => vtex::extract(&doc),
        _ => None,
    };
    if let Some(s) = specific {
        fill(&mut out, s);
    }

    let mut heuristic_note: Option<&str> = None;
    if !has_price(&out) {
        // JSON-LD é o caminho normal do genérico; sem aviso.
        if let Some(j) = jsonld::extract(&doc) {
            fill(&mut out, j);
        }
    }
    if !has_price(&out) {
        if let Some(root) = next_data::find(&doc) {
            if let Some(h) = next_data::heuristic(&root) {
                let had = has_price(&h);
                fill(&mut out, h);
                if had {
                    heuristic_note = Some("Preço obtido por heurística em __NEXT_DATA__; confira o valor.");
                }
            }
        }
    }
    let m = meta::extract(&doc);
    if !has_price(&out) && has_price(&m) {
        heuristic_note = Some("Preço obtido de meta tags; confira o valor.");
    }
    fill(&mut out, m);

    // "à vista" que não é menor que o de lista não informa nada
    if let (Some(l), Some(c)) = (out.list_cents, out.cash_cents) {
        if c >= l {
            out.cash_cents = None;
        }
    }

    out.image_url = out.image_url.as_deref().and_then(|h| resolve_url(url, h));
    out.title = out.title.map(|t| collapse_ws(&t)).filter(|t| !t.is_empty());

    if !has_price(&out) && out.title.is_none() && looks_blocked(html) {
        out.blocked = true;
        out.warnings.push("Página bloqueada (captcha/WAF); a loja não respondeu com o produto.".to_string());
        return out;
    }
    if let Some(n) = heuristic_note {
        out.warnings.push(n.to_string());
    }
    if !has_price(&out) {
        if out.in_stock == Some(false) {
            out.warnings.push("Produto indisponível; sem preço na página.".to_string());
        } else {
            out.warnings.push("Preço não encontrado na página.".to_string());
        }
    }
    if out.title.is_none() {
        out.warnings.push("Título não encontrado na página.".to_string());
    }
    out
}

fn alnum_fold(s: &str) -> String {
    fold(s)
}

/// Guarda de variante: se o item tem `modelToken`, o título extraído deve conter o token
/// (sem diferenciar maiúsculas; tolera separadores como "-" ou espaço). Título ausente = não
/// dá para verificar, então não acusa.
pub fn variant_matches(model_token: Option<&str>, title: Option<&str>) -> bool {
    let Some(token) = model_token.map(|t| t.trim()).filter(|t| !t.is_empty()) else {
        return true;
    };
    let Some(title) = title.map(|t| t.trim()).filter(|t| !t.is_empty()) else {
        return true;
    };
    if title.to_lowercase().contains(&token.to_lowercase()) {
        return true;
    }
    let t = alnum_fold(token);
    !t.is_empty() && alnum_fold(title).contains(&t)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KABUM: &str = include_str!("../../../tests/fixtures/compras/kabum.html");
    const AMAZON: &str = include_str!("../../../tests/fixtures/compras/amazon.html");
    const VTEX: &str = include_str!("../../../tests/fixtures/compras/vtex_carrefour.html");
    const ZOOM: &str = include_str!("../../../tests/fixtures/compras/zoom.html");

    #[test]
    fn detects_adapters_and_stores() {
        assert_eq!(detect_adapter("https://www.kabum.com.br/produto/621162/x"), OfferAdapter::Kabum);
        assert_eq!(detect_adapter("https://www.amazon.com.br/dp/B0FZCT7GGZ"), OfferAdapter::Amazon);
        assert_eq!(detect_adapter("https://www.samsclub.com.br/geladeira/p"), OfferAdapter::Vtex);
        assert_eq!(detect_adapter("https://www.fastshop.com.br/web/p/d/1"), OfferAdapter::Vtex);
        assert_eq!(detect_adapter("https://loja.exemplo.com/p/1"), OfferAdapter::Generic);
        assert_eq!(detect_adapter("não é url"), OfferAdapter::Generic);
        assert_eq!(store_name("https://www.kabum.com.br/x"), "KaBuM");
        assert_eq!(store_name("https://www.samsclub.com.br/x"), "Sam's Club");
        assert_eq!(store_name("https://www.lojadoze.com.br/x"), "Lojadoze");
    }

    #[test]
    fn kabum_list_and_pix() {
        let e = extract(KABUM, "https://www.kabum.com.br/produto/621162/ssd-kingston-nv3");
        assert_eq!(e.adapter, OfferAdapter::Kabum);
        assert_eq!(e.list_cents, Some(135293));
        assert_eq!(e.cash_cents, Some(114999));
        assert_eq!(e.in_stock, Some(true));
        assert_eq!(e.sku.as_deref(), Some("621162"));
        assert!(e.title.as_deref().unwrap_or("").starts_with("SSD Kingston NV3"));
        assert_eq!(e.installments_text.as_deref(), Some("10x de R$ 135,29"));
        assert!(e.image_url.as_deref().unwrap_or("").starts_with("https://images.kabum.com.br/"));
        assert!(!e.blocked);
        assert!(e.warnings.is_empty(), "{:?}", e.warnings);
    }

    #[test]
    fn amazon_price_title_image() {
        let e = extract(AMAZON, "https://www.amazon.com.br/dp/B0FZCT7GGZ");
        assert_eq!(e.adapter, OfferAdapter::Amazon);
        assert_eq!(e.list_cents, Some(34314));
        assert_eq!(e.cash_cents, None);
        assert!(e.title.as_deref().unwrap_or("").starts_with("Umidificador Master Connect 6L Midea"));
        assert_eq!(e.image_url.as_deref(), Some("https://m.media-amazon.com/images/I/61cYNu3Jr6L._AC_SL1500_.jpg"));
        assert_eq!(e.in_stock, Some(true));
        assert_eq!(e.sku.as_deref(), Some("B0FZCT7GGZ"));
        assert!(!e.blocked);
    }

    #[test]
    fn amazon_captcha_is_blocked() {
        let html = "<html><body><form action=\"/errors/validateCaptcha\"><h4>Digite os caracteres que você vê abaixo</h4></form></body></html>";
        let e = extract(html, "https://www.amazon.com.br/dp/B0FZCT7GGZ");
        assert!(e.blocked);
        assert_eq!(e.list_cents, None);
    }

    #[test]
    fn vtex_json_ld_price() {
        let e = extract(VTEX, "https://www.samsclub.com.br/ar-condicionado-electrolux/p");
        assert_eq!(e.adapter, OfferAdapter::Vtex);
        assert_eq!(e.list_cents, Some(259998));
        assert_eq!(e.in_stock, Some(true));
        assert_eq!(e.sku.as_deref(), Some("142645"));
        assert!(e.title.as_deref().unwrap_or("").contains("JE09F"));
        assert!(e.image_url.as_deref().unwrap_or("").starts_with("https://samsclub.vtexassets.com/"));
    }

    #[test]
    fn generic_json_ld_aggregate_offer() {
        let e = extract(ZOOM, "https://www.zoom.com.br/ar-condicionado/ar-condicionado-split-lg-24000-btus-at-w24gplp0");
        assert_eq!(e.adapter, OfferAdapter::Generic);
        assert_eq!(e.list_cents, Some(1299900));
        assert_eq!(e.sku.as_deref(), Some("2647308"));
        assert!(e.title.as_deref().unwrap_or("").contains("AT-W24GPLP0"));
        assert_eq!(e.in_stock, Some(true));
    }

    #[test]
    fn generic_json_ld_single_offer_string_price() {
        let html = r#"<html><head><script type="application/ld+json">
            {"@context":"https://schema.org","@type":["Product"],"name":"Cafeteira X","image":["/img/a.jpg"],
             "offers":{"@type":"Offer","price":"299.90","priceCurrency":"BRL","availability":"https://schema.org/OutOfStock"}}
        </script></head></html>"#;
        let e = extract(html, "https://loja.exemplo.com/p/cafeteira");
        assert_eq!(e.list_cents, Some(29990));
        assert_eq!(e.in_stock, Some(false));
        assert_eq!(e.image_url.as_deref(), Some("https://loja.exemplo.com/img/a.jpg"));
    }

    #[test]
    fn generic_next_data_heuristic_and_installments_never_price() {
        let html = r#"<html><head><title>Loja</title></head><body>
            <p>12x de R$ 99,90 sem juros</p>
            <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"data":{"product":{"name":"Fogão 5 bocas","price":1299.9,"pixPrice":1169.91,"available":true,"sku":"F5"}}}}}
            </script></body></html>"#;
        let e = extract(html, "https://loja.exemplo.com/p/fogao");
        assert_eq!(e.list_cents, Some(129990));
        assert_eq!(e.cash_cents, Some(116991));
        assert_eq!(e.title.as_deref(), Some("Fogão 5 bocas"));
        assert!(e.warnings.iter().any(|w| w.contains("heurística")));
    }

    #[test]
    fn generic_meta_fallback() {
        let html = r#"<html><head><title>x</title>
            <meta property="og:title" content="Liquidificador Y"/>
            <meta property="og:image" content="https://cdn.exemplo.com/y.png"/>
            <meta property="product:price:amount" content="199,90"/></head></html>"#;
        let e = extract(html, "https://loja.exemplo.com/p/y");
        assert_eq!(e.list_cents, Some(19990));
        assert_eq!(e.title.as_deref(), Some("Liquidificador Y"));
    }

    #[test]
    fn no_price_warns() {
        let e = extract("<html><head><title>Página</title></head><body>12x de R$ 99,90</body></html>", "https://loja.exemplo.com/p/z");
        assert_eq!(e.list_cents, None);
        assert!(!e.blocked);
        assert!(e.warnings.iter().any(|w| w.contains("Preço não encontrado")));
    }

    #[test]
    fn variant_guard() {
        assert!(variant_matches(Some("JE09F"), Some("Ar-condicionado Electrolux JE09F Inverter")));
        assert!(variant_matches(Some("je09f"), Some("AR ELECTROLUX JE09F")));
        assert!(!variant_matches(Some("JE09F"), Some("Ar-condicionado Electrolux JE12F")));
        assert!(variant_matches(Some("AT-W24GPLP0"), Some("LG ATW24GPLP0 24000")));
        assert!(variant_matches(None, Some("qualquer")));
        assert!(variant_matches(Some("X1"), None));
        assert!(variant_matches(Some("  "), Some("qualquer")));
    }
}
