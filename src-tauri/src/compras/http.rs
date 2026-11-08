//! Cliente HTTP (blocking), espaçamento por host e classificação de respostas.
//! Nada aqui segura lock do banco; nada faz unwrap/expect no caminho de rede.

use super::extract;
use super::model::{Extracted, OfferAdapter};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
pub const TIMEOUT: Duration = Duration::from_secs(20);
pub const HOST_GAP: Duration = Duration::from_secs(20);
pub const MAX_PAGE_BYTES: u64 = 6 * 1024 * 1024;
pub const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

/// Espaça requisições ao mesmo host (>= `gap`). `now` é injetado para teste.
#[derive(Debug, Default)]
pub struct HostGate {
    last: HashMap<String, Instant>,
}

impl HostGate {
    pub fn wait_needed(&self, host: &str, now: Instant, gap: Duration) -> Duration {
        match self.last.get(host) {
            Some(prev) => {
                let elapsed = now.saturating_duration_since(*prev);
                gap.saturating_sub(elapsed)
            }
            None => Duration::ZERO,
        }
    }

    pub fn mark(&mut self, host: &str, now: Instant) {
        self.last.insert(host.to_string(), now);
    }
}

pub struct Http {
    client: Option<reqwest::blocking::Client>,
    pub gate: Mutex<HostGate>,
}

impl Http {
    pub fn new() -> Http {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .ok();
        Http { client, gate: Mutex::new(HostGate::default()) }
    }

    pub fn host_wait(&self, host: &str, now: Instant) -> Duration {
        match self.gate.lock() {
            Ok(g) => g.wait_needed(host, now, HOST_GAP),
            Err(p) => p.into_inner().wait_needed(host, now, HOST_GAP),
        }
    }

    pub fn host_mark(&self, host: &str, now: Instant) {
        match self.gate.lock() {
            Ok(mut g) => g.mark(host, now),
            Err(p) => p.into_inner().mark(host, now),
        }
    }

    fn client(&self) -> Result<&reqwest::blocking::Client, String> {
        self.client.as_ref().ok_or_else(|| "Cliente HTTP indisponível neste sistema.".to_string())
    }

    /// Baixa uma página HTML. Retorna (status, corpo, url final).
    pub fn fetch_page(&self, url: &str) -> Result<(u16, String, String), String> {
        check_http_url(url)?;
        let resp = self
            .client()?
            .get(url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.6")
            .send()
            .map_err(describe_net_error)?;
        let status = resp.status().as_u16();
        let final_url = resp.url().to_string();
        let mut buf = Vec::new();
        resp.take(MAX_PAGE_BYTES).read_to_end(&mut buf).map_err(|e| format!("Falha ao ler a resposta: {e}"))?;
        Ok((status, String::from_utf8_lossy(&buf).into_owned(), final_url))
    }

    /// GET com `Authorization: Bearer` (APIs oficiais). Retorna (status, corpo).
    pub fn get_bearer(&self, url: &str, token: &str) -> Result<(u16, String), String> {
        check_http_url(url)?;
        let resp = self
            .client()?
            .get(url)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(describe_net_error)?;
        read_text(resp)
    }

    /// POST `application/x-www-form-urlencoded`. Retorna (status, corpo).
    pub fn post_form(&self, url: &str, fields: &[(&str, &str)]) -> Result<(u16, String), String> {
        check_http_url(url)?;
        let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(fields).finish();
        let resp = self
            .client()?
            .post(url)
            .header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .map_err(describe_net_error)?;
        read_text(resp)
    }

    /// Baixa bytes (imagem) respeitando o limite.
    pub fn fetch_bytes(&self, url: &str, max: u64) -> Result<Vec<u8>, String> {
        check_http_url(url)?;
        let resp = self
            .client()?
            .get(url)
            .header("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5")
            .header("Accept-Language", "pt-BR,pt;q=0.9")
            .send()
            .map_err(describe_net_error)?;
        if !resp.status().is_success() {
            return Err(format!("A loja respondeu {} ao baixar a imagem.", resp.status().as_u16()));
        }
        if let Some(len) = resp.content_length() {
            if len > max {
                return Err("Imagem maior que 5 MB.".to_string());
            }
        }
        let mut buf = Vec::new();
        resp.take(max + 1).read_to_end(&mut buf).map_err(|e| format!("Falha ao ler a imagem: {e}"))?;
        if buf.len() as u64 > max {
            return Err("Imagem maior que 5 MB.".to_string());
        }
        Ok(buf)
    }
}

impl Default for Http {
    fn default() -> Self {
        Http::new()
    }
}

fn read_text(resp: reqwest::blocking::Response) -> Result<(u16, String), String> {
    let status = resp.status().as_u16();
    let mut buf = Vec::new();
    resp.take(MAX_PAGE_BYTES).read_to_end(&mut buf).map_err(|e| format!("Falha ao ler a resposta: {e}"))?;
    Ok((status, String::from_utf8_lossy(&buf).into_owned()))
}

fn describe_net_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Tempo esgotado (20 s) ao acessar a loja.".to_string()
    } else if e.is_connect() {
        "Não foi possível conectar à loja.".to_string()
    } else {
        format!("Erro de rede: {e}")
    }
}

pub fn check_http_url(url: &str) -> Result<(), String> {
    match url::Url::parse(url.trim()) {
        Ok(u) if (u.scheme() == "http" || u.scheme() == "https") && u.host_str().is_some() => Ok(()),
        _ => Err("URL inválida: use um endereço http(s) completo.".to_string()),
    }
}

pub fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url.trim()).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailKind {
    /// 403/429/captcha/WAF: backoff e status "blocked".
    Blocked,
    /// 404/410: link morto.
    Gone,
    /// Rede, 5xx, página sem preço.
    Transient,
}

#[derive(Debug, Clone)]
pub enum PollOutcome {
    Success(Extracted),
    Failure { kind: FailKind, message: String },
}

/// Classifica a resposta de uma página de oferta (pura; usada pelo ticker e testada com fixtures).
/// Redirecionamento para página de verificação/captcha (ex.: Mercado Livre `/gz/account-verification`).
pub fn is_block_redirect(final_url: &str) -> bool {
    let u = final_url.to_ascii_lowercase();
    ["account-verification", "captcha", "/challenge"].iter().any(|k| u.contains(k))
}

/// URL usada para escolher o extrator: a digitada, ou a final quando a digitada é genérica
/// (link curto como `a.co/...` que redireciona para a loja).
pub fn extraction_basis<'a>(url: &'a str, final_url: &'a str) -> &'a str {
    if extract::detect_adapter(url) == OfferAdapter::Generic && !final_url.is_empty() {
        final_url
    } else {
        url
    }
}

pub fn evaluate_response(status: u16, html: &str, url: &str) -> PollOutcome {
    let extracted = extract::extract(html, url);
    if extracted.blocked || status == 403 || status == 429 {
        let has_data = extracted.list_cents.is_some() || extracted.cash_cents.is_some();
        // 403/429 com produto legível é raro; se há preço, confia no conteúdo.
        if extracted.blocked || !has_data {
            return PollOutcome::Failure {
                kind: FailKind::Blocked,
                message: format!("A loja bloqueou a consulta (HTTP {status} / captcha). Nova tentativa com espera maior."),
            };
        }
    }
    if status == 404 || status == 410 {
        return PollOutcome::Failure { kind: FailKind::Gone, message: format!("Página não encontrada (HTTP {status}); o link pode ter saído do ar.") };
    }
    if !(200..300).contains(&status) {
        return PollOutcome::Failure { kind: FailKind::Transient, message: format!("A loja respondeu HTTP {status}.") };
    }
    let has_price = extracted.list_cents.is_some() || extracted.cash_cents.is_some();
    if !has_price && extracted.in_stock != Some(false) {
        return PollOutcome::Failure { kind: FailKind::Transient, message: "Preço não encontrado na página.".to_string() };
    }
    PollOutcome::Success(extracted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_gate_spacing_with_injected_now() {
        let mut g = HostGate::default();
        let t0 = Instant::now();
        let gap = Duration::from_secs(20);
        assert_eq!(g.wait_needed("a.com", t0, gap), Duration::ZERO);
        g.mark("a.com", t0);
        assert_eq!(g.wait_needed("a.com", t0 + Duration::from_secs(5), gap), Duration::from_secs(15));
        assert_eq!(g.wait_needed("a.com", t0 + Duration::from_secs(20), gap), Duration::ZERO);
        assert_eq!(g.wait_needed("b.com", t0 + Duration::from_secs(1), gap), Duration::ZERO);
    }

    #[test]
    fn url_checks() {
        assert!(check_http_url("https://www.kabum.com.br/x").is_ok());
        assert!(check_http_url("file:///c:/x").is_err());
        assert!(check_http_url("javascript:alert(1)").is_err());
        assert!(check_http_url("kabum").is_err());
        assert_eq!(host_of("https://WWW.Kabum.com.br/x").as_deref(), Some("www.kabum.com.br"));
    }

    #[test]
    fn classify_status_codes() {
        let page = "<html><head><title>x</title></head></html>";
        assert!(matches!(evaluate_response(403, page, "https://a.com/p"), PollOutcome::Failure { kind: FailKind::Blocked, .. }));
        assert!(matches!(evaluate_response(429, page, "https://a.com/p"), PollOutcome::Failure { kind: FailKind::Blocked, .. }));
        assert!(matches!(evaluate_response(404, page, "https://a.com/p"), PollOutcome::Failure { kind: FailKind::Gone, .. }));
        assert!(matches!(evaluate_response(500, page, "https://a.com/p"), PollOutcome::Failure { kind: FailKind::Transient, .. }));
        assert!(matches!(evaluate_response(200, page, "https://a.com/p"), PollOutcome::Failure { kind: FailKind::Transient, .. }));
    }

    #[test]
    fn classify_amazon_captcha_even_on_200_or_503() {
        let html = "<form action=\"/errors/validateCaptcha\"></form>";
        for st in [200u16, 503] {
            assert!(matches!(
                evaluate_response(st, html, "https://www.amazon.com.br/dp/B0FZCT7GGZ"),
                PollOutcome::Failure { kind: FailKind::Blocked, .. }
            ));
        }
    }

    #[test]
    fn classify_success_on_fixture() {
        let html = include_str!("../../tests/fixtures/compras/kabum.html");
        match evaluate_response(200, html, "https://www.kabum.com.br/produto/621162/x") {
            PollOutcome::Success(e) => assert_eq!(e.cash_cents, Some(114999)),
            other => panic!("esperava sucesso: {other:?}"),
        }
    }

    #[test]
    fn block_redirect_and_extraction_basis() {
        assert!(is_block_redirect("https://www.mercadolivre.com.br/gz/account-verification?go=x"));
        assert!(is_block_redirect("https://loja.com/captcha?x=1"));
        assert!(!is_block_redirect("https://www.mercadolivre.com.br/geladeira-brastemp/p/MLB123"));
        // link curto genérico -> usa a URL final
        assert_eq!(extraction_basis("https://a.co/d/01KKEk0a", "https://www.amazon.com.br/dp/B0X"), "https://www.amazon.com.br/dp/B0X");
        // loja conhecida -> mantém a digitada
        assert_eq!(extraction_basis("https://www.kabum.com.br/produto/1", "https://www.kabum.com.br/produto/1/slug"), "https://www.kabum.com.br/produto/1");
        assert_eq!(extraction_basis("https://a.co/d/x", ""), "https://a.co/d/x");
    }
}
