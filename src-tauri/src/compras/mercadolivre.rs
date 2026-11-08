//! Mercado Livre via API oficial (o site bloqueia consultas automáticas com verificação).
//!
//! Autenticação `client_credentials` (App ID + chave secreta do app criado pelo usuário em
//! developers.mercadolivre.com.br), sem login de usuário. Credenciais no keyring do SO.
//! `/items/{id}` de outros vendedores responde 403 mesmo com token, então o preço vem do
//! catálogo: `/products/{id}` (nome, fotos) + `/products/{id}/items` (anúncios e preços).
//! Por isso só links de catálogo (`.../p/MLB123...`) são suportados.

use super::http::{FailKind, Http, PollOutcome};
use super::model::{Extracted, OfferAdapter};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const API: &str = "https://api.mercadolibre.com";
const SERVICE: &str = "com.krieg.fileorganizer";
const KEY_USER: &str = "mercadolivre-app";
pub const STORE: &str = "Mercado Livre";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MlCredentials {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MlStatus {
    pub configured: bool,
    pub client_id: Option<String>,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, KEY_USER).map_err(|e| e.to_string())
}

pub fn load_credentials() -> Result<Option<MlCredentials>, String> {
    match entry()?.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_credentials(c: &MlCredentials) -> Result<(), String> {
    let raw = serde_json::to_string(c).map_err(|e| e.to_string())?;
    entry()?.set_password(&raw).map_err(|e| e.to_string())
}

pub fn clear_credentials() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn status() -> MlStatus {
    match load_credentials() {
        Ok(Some(c)) => MlStatus { configured: true, client_id: Some(c.client_id) },
        _ => MlStatus::default(),
    }
}

/// Cache do token de app (validade informada pela API, com 5 min de folga).
#[derive(Default)]
pub struct MlAuth {
    token: Mutex<Option<(String, Instant)>>,
}

impl MlAuth {
    pub fn invalidate(&self) {
        if let Ok(mut g) = self.token.lock() {
            *g = None;
        }
    }

    fn cached(&self) -> Option<String> {
        let g = self.token.lock().ok()?;
        match &*g {
            Some((t, until)) if Instant::now() < *until => Some(t.clone()),
            _ => None,
        }
    }

    fn store(&self, token: &str, expires_in: u64) {
        if let Ok(mut g) = self.token.lock() {
            let ttl = Duration::from_secs(expires_in.saturating_sub(300).max(60));
            *g = Some((token.to_string(), Instant::now() + ttl));
        }
    }
}

/// Pede um token novo (`client_credentials`). Não usa cache: serve também para validar credenciais.
pub fn request_token(http: &Http, c: &MlCredentials) -> Result<(String, u64), String> {
    let (status, body) = http.post_form(
        &format!("{API}/oauth/token"),
        &[("grant_type", "client_credentials"), ("client_id", c.client_id.trim()), ("client_secret", c.client_secret.trim())],
    )?;
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        let msg = v.get("message").and_then(Value::as_str).unwrap_or("");
        return Err(format!("O Mercado Livre recusou as credenciais (HTTP {status}). {msg}").trim().to_string());
    }
    let token = v.get("access_token").and_then(Value::as_str).ok_or("Resposta sem access_token.")?;
    let expires = v.get("expires_in").and_then(Value::as_u64).unwrap_or(21600);
    Ok((token.to_string(), expires))
}

fn token(http: &Http, auth: &MlAuth) -> Result<String, Failure> {
    if let Some(t) = auth.cached() {
        return Ok(t);
    }
    let creds = load_credentials().ok().flatten().ok_or(Failure::NotConfigured)?;
    let (t, exp) = request_token(http, &creds).map_err(Failure::Auth)?;
    auth.store(&t, exp);
    Ok(t)
}

/// Referência extraída de um link de catálogo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlRef {
    pub product_id: String,
    pub item_id: Option<String>,
}

fn is_mlb_id(s: &str) -> bool {
    s.len() > 3 && s[..3].eq_ignore_ascii_case("MLB") && s[3..].chars().all(|c| c.is_ascii_digit())
}

/// `.../p/MLB65575170?pdp_filters=item_id:MLB4473743551` -> produto + anúncio (se houver).
pub fn parse_url(url: &str) -> Option<MlRef> {
    let u = url::Url::parse(url.trim()).ok()?;
    let segs: Vec<&str> = u.path_segments()?.collect();
    let pos = segs.iter().position(|s| *s == "p")?;
    let product_id = segs.get(pos + 1).filter(|s| is_mlb_id(s))?.to_uppercase();
    let mut item_id = None;
    for (k, v) in u.query_pairs() {
        let cand = match k.as_ref() {
            "pdp_filters" => v.split(',').find_map(|f| f.strip_prefix("item_id:")).map(str::to_string),
            "item_id" | "wid" => Some(v.to_string()),
            _ => None,
        };
        if let Some(c) = cand.filter(|c| is_mlb_id(c)) {
            item_id = Some(c.to_uppercase());
            break;
        }
    }
    Some(MlRef { product_id, item_id })
}

fn to_cents(v: &Value) -> Option<i64> {
    let f = v.as_f64()?;
    (f.is_finite() && f > 0.0).then(|| (f * 100.0).round() as i64)
}

fn pic_url(p: &Value) -> Option<String> {
    p.get("url").or_else(|| p.get("secure_url")).and_then(Value::as_str).map(|s| s.replace("http://", "https://"))
}

/// `/products/{id}` -> (nome, primeira foto, preço do buy box se houver).
pub fn parse_product(v: &Value) -> (Option<String>, Option<String>, Option<i64>) {
    let name = v.get("name").and_then(Value::as_str).map(str::to_string);
    let image = v.get("pictures").and_then(Value::as_array).and_then(|a| a.iter().find_map(pic_url));
    let buy_box = v.get("buy_box_winner").and_then(|b| b.get("price")).and_then(to_cents);
    (name, image, buy_box)
}

/// Anúncio escolhido de `/products/{id}/items`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlListing {
    pub item_id: String,
    pub price_cents: i64,
    pub original_cents: Option<i64>,
    pub free_shipping: bool,
}

/// Escolhe o anúncio do link (`item_id`); senão o menor preço entre os novos.
pub fn pick_listing(v: &Value, item_id: Option<&str>) -> Option<MlListing> {
    let results = v.get("results").and_then(Value::as_array)?;
    let listings: Vec<(MlListing, bool)> = results
        .iter()
        .filter_map(|r| {
            let id = r.get("item_id").or_else(|| r.get("id")).and_then(Value::as_str)?.to_uppercase();
            let price = r.get("price").and_then(to_cents)?;
            let is_new = r.get("condition").and_then(Value::as_str).map(|c| c == "new").unwrap_or(true);
            let free = r.get("shipping").and_then(|s| s.get("free_shipping")).and_then(Value::as_bool).unwrap_or(false);
            let original = r.get("original_price").and_then(to_cents).filter(|o| *o > price);
            Some((MlListing { item_id: id, price_cents: price, original_cents: original, free_shipping: free }, is_new))
        })
        .collect();
    if let Some(wanted) = item_id {
        if let Some((l, _)) = listings.iter().find(|(l, _)| l.item_id.eq_ignore_ascii_case(wanted)) {
            return Some(l.clone());
        }
    }
    listings.into_iter().filter(|(_, new)| *new).map(|(l, _)| l).min_by_key(|l| l.price_cents)
}

/// Monta o `Extracted` a partir das duas respostas (pura, testável).
pub fn build_extracted(url: &str, r: &MlRef, product: &Value, items: Option<&Value>) -> Extracted {
    let (name, image, buy_box) = parse_product(product);
    let listing = items.and_then(|v| pick_listing(v, r.item_id.as_deref()));
    let mut warnings = Vec::new();
    if let (Some(wanted), Some(l)) = (&r.item_id, &listing) {
        if !l.item_id.eq_ignore_ascii_case(wanted) {
            warnings.push(format!("O anúncio {wanted} do link não está mais ativo; usando o menor preço do catálogo."));
        }
    }
    if listing.as_ref().map(|l| l.free_shipping).unwrap_or(false) {
        warnings.push("Frete grátis neste anúncio.".to_string());
    }
    let price = listing.as_ref().map(|l| l.price_cents).or(buy_box);
    Extracted {
        url: url.to_string(),
        store: STORE.to_string(),
        adapter: OfferAdapter::MercadoLivre,
        title: name,
        image_url: image,
        list_cents: price,
        cash_cents: None,
        installments_text: None,
        in_stock: Some(price.is_some()),
        sku: Some(listing.map(|l| l.item_id).unwrap_or_else(|| r.product_id.clone())),
        blocked: false,
        warnings,
    }
}

#[derive(Debug)]
enum Failure {
    NotConfigured,
    Auth(String),
    Http(u16, String),
    Net(String),
}

fn get_json(http: &Http, auth: &MlAuth, path: &str) -> Result<Value, Failure> {
    for attempt in 0..2 {
        let t = token(http, auth)?;
        let (status, body) = http.get_bearer(&format!("{API}{path}"), &t).map_err(Failure::Net)?;
        if status == 401 && attempt == 0 {
            auth.invalidate(); // token expirado: pede outro uma vez
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(Failure::Http(status, body));
        }
        return serde_json::from_str(&body).map_err(|e| Failure::Net(format!("Resposta inválida da API: {e}")));
    }
    Err(Failure::Http(401, String::new()))
}

fn fetch(http: &Http, auth: &MlAuth, url: &str) -> Result<Extracted, Failure> {
    let r = parse_url(url).ok_or_else(|| {
        Failure::Http(
            0,
            "Use o link de catálogo do produto (com /p/MLB...). Abra o anúncio no Mercado Livre e copie o link da página do produto.".to_string(),
        )
    })?;
    let product = get_json(http, auth, &format!("/products/{}", r.product_id))?;
    // a lista de anúncios pode falhar (produto sem vendedores); o buy box vira o plano B
    let items = get_json(http, auth, &format!("/products/{}/items", r.product_id)).ok();
    Ok(build_extracted(url, &r, &product, items.as_ref()))
}

fn describe(f: Failure) -> (FailKind, String) {
    match f {
        Failure::NotConfigured => (
            FailKind::Blocked,
            "Configure a API do Mercado Livre (Compras > Configurações) para consultar este preço.".to_string(),
        ),
        Failure::Auth(m) => (FailKind::Blocked, m),
        Failure::Http(0, m) => (FailKind::Gone, m),
        Failure::Http(404, _) => (FailKind::Gone, "Produto não encontrado no catálogo do Mercado Livre.".to_string()),
        Failure::Http(s @ (403 | 429), _) => (FailKind::Blocked, format!("A API do Mercado Livre recusou a consulta (HTTP {s}).")),
        Failure::Http(s, _) => (FailKind::Transient, format!("A API do Mercado Livre respondeu HTTP {s}.")),
        Failure::Net(m) => (FailKind::Transient, m),
    }
}

/// Usado pelo ticker.
pub fn poll(http: &Http, auth: &MlAuth, url: &str) -> PollOutcome {
    match fetch(http, auth, url) {
        Ok(e) if e.list_cents.is_some() => PollOutcome::Success(e),
        Ok(_) => PollOutcome::Failure { kind: FailKind::Transient, message: "Nenhum anúncio ativo com preço neste produto.".to_string() },
        Err(f) => {
            let (kind, message) = describe(f);
            PollOutcome::Failure { kind, message }
        }
    }
}

/// Usado pela pré-visualização do link.
pub fn preview(http: &Http, auth: &MlAuth, url: &str) -> Result<Extracted, String> {
    match fetch(http, auth, url) {
        Ok(e) => Ok(e),
        Err(f) => {
            let (kind, message) = describe(f);
            if kind == FailKind::Blocked {
                Ok(Extracted {
                    url: url.to_string(),
                    store: STORE.to_string(),
                    adapter: OfferAdapter::MercadoLivre,
                    blocked: true,
                    warnings: vec![message],
                    ..Default::default()
                })
            } else {
                Err(message)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const URL: &str = "https://www.mercadolivre.com.br/geladeira-brastemp-frost-free-inverse-500-litros-black-inox-bre66ae/p/MLB65575170?pdp_filters=item_id%3AMLB4473743551&from=gshop";

    #[test]
    fn parses_catalog_urls() {
        assert_eq!(parse_url(URL), Some(MlRef { product_id: "MLB65575170".into(), item_id: Some("MLB4473743551".into()) }));
        assert_eq!(
            parse_url("https://www.mercadolivre.com.br/x/p/MLB123?wid=MLB999").unwrap().item_id.as_deref(),
            Some("MLB999")
        );
        assert_eq!(parse_url("https://www.mercadolivre.com.br/x/p/MLB123").unwrap().item_id, None);
        // anúncio avulso (sem catálogo) não é suportado
        assert_eq!(parse_url("https://produto.mercadolivre.com.br/MLB-123456-geladeira-_JM"), None);
        assert_eq!(parse_url("https://www.mercadolivre.com.br/x/p/abc"), None);
    }

    fn items() -> Value {
        json!({ "paging": { "total": 3 }, "results": [
            { "item_id": "MLB111", "price": 4299.0, "condition": "new", "shipping": { "free_shipping": true } },
            { "item_id": "MLB4473743551", "price": 4499.9, "original_price": 5199.0, "condition": "new", "shipping": { "free_shipping": false } },
            { "item_id": "MLB222", "price": 3000.0, "condition": "used" }
        ]})
    }

    #[test]
    fn picks_link_listing_else_cheapest_new() {
        let l = pick_listing(&items(), Some("MLB4473743551")).unwrap();
        assert_eq!((l.price_cents, l.original_cents), (449990, Some(519900)));
        let l = pick_listing(&items(), None).unwrap();
        assert_eq!((l.item_id.as_str(), l.price_cents, l.free_shipping), ("MLB111", 429900, true));
        // anúncio do link sumiu -> menor novo (usado é ignorado)
        assert_eq!(pick_listing(&items(), Some("MLB000")).unwrap().item_id, "MLB111");
        assert!(pick_listing(&json!({ "results": [] }), None).is_none());
    }

    #[test]
    fn builds_extracted_with_fallbacks() {
        let product = json!({ "name": "Geladeira Brastemp Frost Free Inverse 500L", "pictures": [{ "url": "http://http2.mlstatic.com/a.jpg" }], "buy_box_winner": { "price": 4100.5 } });
        let r = parse_url(URL).unwrap();
        let e = build_extracted(URL, &r, &product, Some(&items()));
        assert_eq!(e.adapter, OfferAdapter::MercadoLivre);
        assert_eq!(e.list_cents, Some(449990));
        assert_eq!(e.image_url.as_deref(), Some("https://http2.mlstatic.com/a.jpg"));
        assert_eq!(e.sku.as_deref(), Some("MLB4473743551"));
        assert!(e.warnings.is_empty());
        // sem lista de anúncios -> buy box
        let e = build_extracted(URL, &r, &product, None);
        assert_eq!(e.list_cents, Some(410050));
        // nada de preço -> sem estoque
        let e = build_extracted(URL, &r, &json!({ "name": "X" }), Some(&json!({ "results": [] })));
        assert_eq!((e.list_cents, e.in_stock), (None, Some(false)));
    }

    #[test]
    fn failures_map_to_poll_kinds() {
        assert_eq!(describe(Failure::NotConfigured).0, FailKind::Blocked);
        assert_eq!(describe(Failure::Http(404, String::new())).0, FailKind::Gone);
        assert_eq!(describe(Failure::Http(403, String::new())).0, FailKind::Blocked);
        assert_eq!(describe(Failure::Http(500, String::new())).0, FailKind::Transient);
        assert_eq!(describe(Failure::Http(0, "x".into())).0, FailKind::Gone);
    }
}
