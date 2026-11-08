//! Discord como segundo canal de avisos (Compras v2, P10).
//!
//! Mesmas regras do desktop (decisão, dedup e cooldown vêm de `alerts::decide`); aqui só mora a entrega.
//! A URL do webhook é segredo (quem a tem posta no canal): fica SÓ no cofre do SO, nunca em configurações,
//! banco ou log. Só aceitamos URLs de webhook do próprio Discord (lista fechada de hosts, caminho exato),
//! então a URL colada não vira um jeito de fazer o app chamar endereços arbitrários.

use super::alerts::{self, AlertChannel, Toast};
use super::db;
use super::model::*;
use super::money;
use chrono::{DateTime, Utc};
use keyring::Entry;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

const SERVICE: &str = "com.krieg.fileorganizer";
const KEY_USER: &str = "compras-discord-webhook";

/// Verde de destaque do Compras (#2DC98A).
pub const ACCENT: u32 = 0x2DC98A;
const FOOTER: &str = "Tonho · Compras para Casa";
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// Espera máxima aceita num 429; acima disso desiste (o ticker não pode ficar preso).
pub const MAX_RETRY_WAIT_MS: u64 = 5_000;
const DEFAULT_RETRY_MS: u64 = 1_000;

const ALLOWED_HOSTS: [&str; 6] = [
    "discord.com",
    "ptb.discord.com",
    "canary.discord.com",
    "discordapp.com",
    "ptb.discordapp.com",
    "canary.discordapp.com",
];

// ---------------------------------------------------------------- URL do webhook

/// Webhook já validado. `Debug` não mostra o token.
#[derive(Clone, PartialEq, Eq)]
pub struct Webhook {
    host: String,
    id: String,
    token: String,
}

impl fmt::Debug for Webhook {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Webhook({}/…{})", self.host, self.id.len())
    }
}

impl Webhook {
    /// URL canônica reconstruída só das partes validadas.
    pub fn url(&self) -> String {
        format!("https://{}/api/webhooks/{}/{}", self.host, self.id, self.token)
    }

    /// "…/webhooks/1234…/••••": o suficiente para reconhecer, sem o token.
    pub fn hint(&self) -> String {
        let head: String = self.id.chars().take(4).collect();
        format!("…/webhooks/{head}…/••••")
    }
}

const BAD_URL: &str = "Isso não parece um webhook do Discord. A URL começa com https://discord.com/api/webhooks/ e tem dois trechos depois disso.";

/// Aceita só `https://{discord.com|discordapp.com|ptb.|canary.}/api/webhooks/{id}/{token}`: sem porta,
/// usuário, query, fragmento, barra final ou qualquer caractere fora do esperado.
pub fn parse_webhook(raw: &str) -> Result<Webhook, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Cole a URL do webhook.".to_string());
    }
    if raw.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(BAD_URL.to_string());
    }
    let u = url::Url::parse(raw).map_err(|_| BAD_URL.to_string())?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() || u.port().is_some() || u.query().is_some() || u.fragment().is_some() {
        return Err(BAD_URL.to_string());
    }
    let host = u.host_str().map(str::to_ascii_lowercase).ok_or_else(|| BAD_URL.to_string())?;
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(BAD_URL.to_string());
    }
    let segs: Vec<&str> = u.path_segments().map(|s| s.collect()).unwrap_or_default();
    let [api, webhooks, id, token] = segs.as_slice() else {
        return Err(BAD_URL.to_string());
    };
    let id_ok = (10..=25).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit());
    let token_ok = (8..=200).contains(&token.len()) && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if *api != "api" || *webhooks != "webhooks" || !id_ok || !token_ok {
        return Err(BAD_URL.to_string());
    }
    Ok(Webhook { host, id: id.to_string(), token: token.to_string() })
}

// ---------------------------------------------------------------- cofre do SO

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub configured: bool,
    pub webhook_hint: Option<String>,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, KEY_USER).map_err(|e| e.to_string())
}

/// `Ok(None)` = não configurado (ou valor guardado inválido).
pub fn load_webhook() -> Result<Option<Webhook>, String> {
    match entry()?.get_password() {
        Ok(raw) => Ok(parse_webhook(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_webhook(w: &Webhook) -> Result<(), String> {
    entry()?.set_password(&w.url()).map_err(|e| e.to_string())
}

pub fn clear_webhook() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn status() -> DiscordStatus {
    match load_webhook() {
        Ok(Some(w)) => DiscordStatus { configured: true, webhook_hint: Some(w.hint()) },
        _ => DiscordStatus::default(),
    }
}

// ---------------------------------------------------------------- mensagem

/// Só `""` ou `"@here"`: qualquer outro valor vira vazio (nada de @everyone, cargos ou usuários).
pub fn normalize_mention(s: &str) -> &'static str {
    if s.trim() == "@here" {
        "@here"
    } else {
        ""
    }
}

/// Dados de um evento que o `AlertEvent` não carrega.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EventCtx {
    pub store: String,
    /// Link da melhor oferta.
    pub url: Option<String>,
    pub target_cents: Option<i64>,
    /// Só URL http(s) de imagem já conhecida; nada de arquivo local.
    pub image_url: Option<String>,
    pub mention_here: bool,
}

/// Escapa o markdown do Discord e neutraliza `@`; quebras de linha viram espaço.
pub fn escape_md(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\\' | '*' | '_' | '~' | '`' | '|' | '>' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            '@' => {
                out.push('@');
                out.push('\u{200B}');
            }
            '\r' | '\n' | '\t' => out.push(' '),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
    t.push('…');
    t
}

fn http_url(s: &str) -> Option<String> {
    let u = url::Url::parse(s.trim()).ok()?;
    ((u.scheme() == "http" || u.scheme() == "https") && u.host_str().is_some()).then(|| u.to_string())
}

fn brl(c: i64) -> String {
    format!("R$ {}", money::format_brl(c))
}

fn timestamp(s: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Envelope comum: menção só quando permitida e `allowed_mentions` fechado em qualquer caso.
fn envelope(embed: Value, mention_here: bool) -> Value {
    let parse: Vec<&str> = if mention_here { vec!["everyone"] } else { Vec::new() };
    let mut msg = json!({
        "allowed_mentions": { "parse": parse },
        "embeds": [embed],
    });
    if mention_here {
        msg["content"] = json!("@here");
    }
    msg
}

/// Uma mensagem (embed) por evento.
pub fn build_payload(event: &AlertEvent, ctx: &EventCtx) -> Value {
    let name = escape_md(&truncate(&event.item_name, 100));
    let mut embed = json!({
        "title": alerts::title_for(event.kind, &name),
        "description": truncate(&escape_md(&event.reason), 1000),
        "color": ACCENT,
        "footer": { "text": FOOTER },
    });
    if let Some(u) = ctx.url.as_deref().and_then(http_url) {
        embed["url"] = json!(u);
    }
    let mut fields = vec![json!({ "name": "Preço", "value": brl(event.price_cents), "inline": true })];
    if let (AlertKind::Target, Some(t)) = (event.kind, ctx.target_cents) {
        fields.push(json!({ "name": "Você pediu", "value": brl(t), "inline": true }));
    }
    let store = escape_md(ctx.store.trim());
    if !store.is_empty() {
        fields.push(json!({ "name": "Loja", "value": truncate(&store, 100), "inline": true }));
    }
    embed["fields"] = Value::Array(fields);
    if let Some(img) = ctx.image_url.as_deref().and_then(http_url) {
        embed["thumbnail"] = json!({ "url": img });
    }
    if let Some(ts) = timestamp(&event.created_at) {
        embed["timestamp"] = json!(ts);
    }
    envelope(embed, ctx.mention_here)
}

/// Resumo do limite por ciclo ("+N itens no preço") e mensagem de teste: título e texto livres.
pub fn build_summary_payload(toast: &Toast, mention_here: bool, now: DateTime<Utc>) -> Value {
    let embed = json!({
        "title": truncate(&escape_md(&toast.title), 256),
        "description": truncate(&escape_md(&toast.body), 1000),
        "color": ACCENT,
        "footer": { "text": FOOTER },
        "timestamp": now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    });
    envelope(embed, mention_here)
}

pub fn test_toast() -> Toast {
    Toast {
        title: "Aviso de teste".to_string(),
        body: "Se você está vendo isto no Discord, os avisos de preço do Tonho estão funcionando.".to_string(),
        event_ids: Vec::new(),
    }
}

// ---------------------------------------------------------------- envio

pub struct Reply {
    pub status: u16,
    pub body: String,
}

/// Transporte HTTP (trocado por um falso nos testes: nenhum teste fala com o Discord de verdade).
pub trait Transport: Send + Sync {
    fn post(&self, url: &str, body: &str) -> Result<Reply, String>;
    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

/// Cliente próprio: 10 s, sem seguir redirecionamentos (o webhook nunca deveria redirecionar).
pub struct ReqwestTransport {
    client: Option<reqwest::blocking::Client>,
}

impl ReqwestTransport {
    pub fn new() -> ReqwestTransport {
        let client = reqwest::blocking::Client::builder()
            .user_agent("Tonho-Compras/1.0")
            .timeout(SEND_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok();
        ReqwestTransport { client }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        ReqwestTransport::new()
    }
}

impl Transport for ReqwestTransport {
    fn post(&self, url: &str, body: &str) -> Result<Reply, String> {
        let client = self.client.as_ref().ok_or("Cliente HTTP indisponível.")?;
        // `without_url`: a mensagem de erro do reqwest traria a URL (com o token) para o log
        let resp = client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .map_err(|e| {
                let e = e.without_url();
                if e.is_timeout() {
                    "Tempo esgotado (10 s) ao falar com o Discord.".to_string()
                } else if e.is_connect() {
                    "Não foi possível conectar ao Discord.".to_string()
                } else {
                    format!("Erro de rede ao falar com o Discord: {e}")
                }
            })?;
        let status = resp.status().as_u16();
        let body = resp.text().unwrap_or_default();
        Ok(Reply { status, body })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SendError {
    Network(String),
    Status(u16),
    /// 429 com espera maior que o aceitável (ms) ou que persistiu depois da nova tentativa.
    RateLimited(u64),
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SendError::Network(m) => f.write_str(m),
            SendError::Status(s) => write!(f, "o Discord respondeu HTTP {s}"),
            SendError::RateLimited(ms) => write!(f, "limite de envios do Discord (espera de {ms} ms)"),
        }
    }
}

impl SendError {
    /// Texto para o usuário (sem URL nem token).
    pub fn friendly(&self) -> String {
        match self {
            SendError::Network(m) => m.clone(),
            SendError::Status(401 | 403 | 404) => {
                "O Discord não reconheceu esse webhook. Confira se a URL está completa e se o webhook não foi apagado do canal.".to_string()
            }
            SendError::Status(s) => format!("O Discord recusou a mensagem (HTTP {s})."),
            SendError::RateLimited(_) => "O Discord pediu para esperar um pouco. Tente de novo em instantes.".to_string(),
        }
    }
}

/// `retry_after` (segundos, pode ser fracionário) do corpo de um 429, em ms.
fn retry_after_ms(body: &str) -> Option<u64> {
    let v: Value = serde_json::from_str(body).ok()?;
    let secs = v.get("retry_after")?.as_f64()?;
    (secs.is_finite() && secs >= 0.0).then(|| (secs * 1000.0).ceil() as u64)
}

/// POST com uma nova tentativa em 429 (respeitando `retry_after`, no máximo 5 s). Qualquer outra falha desiste.
pub fn post_with_retry(t: &dyn Transport, url: &str, payload: &Value) -> Result<(), SendError> {
    let body = payload.to_string();
    let mut retried = false;
    loop {
        let r = t.post(url, &body).map_err(SendError::Network)?;
        match r.status {
            200..=299 => return Ok(()),
            429 => {
                let wait = retry_after_ms(&r.body).unwrap_or(DEFAULT_RETRY_MS);
                if retried || wait > MAX_RETRY_WAIT_MS {
                    return Err(SendError::RateLimited(wait));
                }
                retried = true;
                t.sleep_ms(wait);
            }
            s => return Err(SendError::Status(s)),
        }
    }
}

/// Mensagem de teste (a URL ainda não está no cofre quando o botão CONECTAR valida).
pub fn send_test(t: &dyn Transport, w: &Webhook) -> Result<(), SendError> {
    post_with_retry(t, &w.url(), &build_summary_payload(&test_toast(), false, Utc::now()))
}

// ---------------------------------------------------------------- canal

/// Canal do Discord. Evento único vira embed completo; o resumo do limite por ciclo vira uma mensagem só.
pub struct DiscordChannel<T: Transport> {
    webhook: Webhook,
    mention_here: bool,
    events: HashMap<String, (AlertEvent, EventCtx)>,
    transport: T,
}

impl<T: Transport> DiscordChannel<T> {
    pub fn new(webhook: Webhook, mention_here: bool, events: HashMap<String, (AlertEvent, EventCtx)>, transport: T) -> Self {
        DiscordChannel { webhook, mention_here, events, transport }
    }
}

impl<T: Transport> AlertChannel for DiscordChannel<T> {
    fn name(&self) -> &'static str {
        "discord"
    }

    fn send(&self, toast: &Toast) -> Result<(), String> {
        let single = match toast.event_ids.as_slice() {
            [id] => self.events.get(id),
            _ => None,
        };
        let payload = match single {
            Some((ev, ctx)) => build_payload(ev, ctx),
            None => build_summary_payload(toast, self.mention_here, Utc::now()),
        };
        post_with_retry(&self.transport, &self.webhook.url(), &payload).map_err(|e| e.to_string())
    }
}

/// Esse evento vai para o Discord? Mesmas decisões do desktop; `toast` = o motor mandou notificar agora.
/// Em horário silencioso (evento `pending`) só vai direto se o usuário desligou "respeitar horário silencioso";
/// nesse caso o desktop ainda entrega depois e o Discord não repete (`delivered_discord`).
pub fn wants(ev: &AlertEvent, toast: bool, s: &ComprasSettings) -> bool {
    if !s.discord_enabled || !s.notify_enabled || ev.delivered_discord {
        return false;
    }
    if ev.kind == AlertKind::NewLow && !s.discord_new_low {
        return false;
    }
    toast || (ev.pending && !s.discord_respect_quiet_hours)
}

/// Junta oferta (loja e link) e alvo de cada evento. Roda com o banco travado, mas só lê.
pub fn build_contexts(conn: &Connection, events: &[AlertEvent], mention_here: bool) -> HashMap<String, (AlertEvent, EventCtx)> {
    events
        .iter()
        .map(|e| {
            let offer = e.offer_id.as_deref().and_then(|id| db::get_offer(conn, id).ok().flatten());
            let target = db::get_rule(conn, &e.item_id).ok().flatten().and_then(|r| r.target_cents);
            let ctx = EventCtx {
                store: offer.as_ref().map(|o| o.store.clone()).unwrap_or_default(),
                url: offer.and_then(|o| o.url),
                target_cents: target,
                // não guardamos o endereço remoto da foto: só existe cópia local, que não enviamos
                image_url: None,
                mention_here,
            };
            (e.id.clone(), (e.clone(), ctx))
        })
        .collect()
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    const ID: &str = "1234567890123456789";
    const TOKEN: &str = "abcDEF-ghi_JKL0123456789abcDEF-ghi_JKL0123456789abcDEF-ghi_JKL01";

    fn good(host: &str) -> String {
        format!("https://{host}/api/webhooks/{ID}/{TOKEN}")
    }

    #[test]
    fn url_accepts_valid_variants() {
        for host in ALLOWED_HOSTS {
            let w = parse_webhook(&good(host)).unwrap_or_else(|e| panic!("{host}: {e}"));
            assert_eq!(w.url(), good(host));
        }
        // espaços nas pontas e host em maiúsculas
        let w = parse_webhook(&format!("  https://DISCORD.com/api/webhooks/{ID}/{TOKEN}\n")).unwrap();
        assert_eq!(w.url(), good("discord.com"));
        // porta padrão explícita é a mesma coisa
        assert!(parse_webhook(&format!("https://discord.com:443/api/webhooks/{ID}/{TOKEN}")).is_ok());
    }

    #[test]
    fn url_rejects_everything_else() {
        let bad = [
            "".to_string(),
            "lixo".to_string(),
            format!("http://discord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://evil.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com.evil.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://evildiscord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://evil.com/discord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com@evil.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com:pass@discord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com\\@evil.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com:8443/api/webhooks/{ID}/{TOKEN}"),
            format!("https://cdn.discord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("https://127.0.0.1/api/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com/api/webhooks/{ID}"),
            format!("https://discord.com/api/webhooks/{ID}/"),
            format!("https://discord.com/api/webhooks//{TOKEN}"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN}/"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN}/extra"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN}?wait=true"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN}?x=https://evil.com"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN}#frag"),
            format!("https://discord.com/api/v10/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com/other/webhooks/{ID}/{TOKEN}"),
            format!("https://discord.com/api/webhooks/abc/{TOKEN}"),
            format!("https://discord.com/api/webhooks/{ID}/tok%2Fen12345"),
            format!("https://discord.com/api/webhooks/{ID}/{TOKEN} https://evil.com"),
            format!("https://discord.com/api/webhooks/{ID}/to ken12345"),
            format!("ftp://discord.com/api/webhooks/{ID}/{TOKEN}"),
            format!("//discord.com/api/webhooks/{ID}/{TOKEN}"),
        ];
        for b in bad {
            assert!(parse_webhook(&b).is_err(), "should reject: {b:?}");
        }
    }

    #[test]
    fn hint_and_debug_never_show_the_token() {
        let w = parse_webhook(&good("discord.com")).unwrap();
        assert_eq!(w.hint(), "…/webhooks/1234…/••••");
        assert!(!w.hint().contains(TOKEN));
        assert!(!format!("{w:?}").contains(TOKEN));
        assert!(!format!("{w:?}").contains(ID));
    }

    #[test]
    fn mention_is_only_here_or_nothing() {
        assert_eq!(normalize_mention("@here"), "@here");
        assert_eq!(normalize_mention(" @here "), "@here");
        for s in ["", "@everyone", "@here @everyone", "<@123>", "<@&456>", "here", "@HERE"] {
            assert_eq!(normalize_mention(s), "", "{s:?}");
        }
    }

    // ---- payload

    fn ev(kind: AlertKind, name: &str) -> AlertEvent {
        AlertEvent {
            id: "e1".into(),
            item_id: "i1".into(),
            offer_id: Some("o1".into()),
            kind,
            price_cents: 149_990,
            prev_cents: Some(170_000),
            reason: "R$ 1.499,90 na KaBuM (Pix + frete). Você pediu R$ 1.500,00.".into(),
            created_at: "2026-11-08T15:00:00Z".into(),
            pending: false,
            seen: false,
            delivered_desktop: false,
            delivered_discord: false,
            item_name: name.into(),
            title: alerts::title_for(kind, name),
        }
    }

    fn ctx() -> EventCtx {
        EventCtx {
            store: "KaBuM".into(),
            url: Some("https://www.kabum.com.br/produto/1".into()),
            target_cents: Some(150_000),
            image_url: None,
            mention_here: false,
        }
    }

    fn embed(p: &Value) -> &Value {
        &p["embeds"][0]
    }

    fn field<'a>(p: &'a Value, name: &str) -> Option<&'a Value> {
        embed(p)["fields"].as_array()?.iter().find(|f| f["name"] == name)
    }

    #[test]
    fn payload_target_has_all_fields() {
        let p = build_payload(&ev(AlertKind::Target, "Placa de vídeo RTX 4060"), &ctx());
        let e = embed(&p);
        assert_eq!(e["title"], "Chegou no preço: Placa de vídeo RTX 4060");
        assert_eq!(e["url"], "https://www.kabum.com.br/produto/1");
        assert_eq!(e["description"], "R$ 1.499,90 na KaBuM (Pix + frete). Você pediu R$ 1.500,00.");
        assert_eq!(e["color"], 0x2DC98A);
        assert_eq!(e["footer"]["text"], "Tonho · Compras para Casa");
        assert_eq!(e["timestamp"], "2026-11-08T15:00:00Z");
        assert_eq!(field(&p, "Preço").unwrap()["value"], "R$ 1.499,90");
        assert_eq!(field(&p, "Preço").unwrap()["inline"], true);
        assert_eq!(field(&p, "Você pediu").unwrap()["value"], "R$ 1.500,00");
        assert_eq!(field(&p, "Loja").unwrap()["value"], "KaBuM");
        assert!(e.get("thumbnail").is_none());
        assert_eq!(p["allowed_mentions"]["parse"], json!([]));
        assert!(p.get("content").is_none());
    }

    #[test]
    fn payload_new_low_has_no_target_field() {
        let p = build_payload(&ev(AlertKind::NewLow, "SSD 1 TB"), &ctx());
        assert_eq!(embed(&p)["title"], "Novo menor preço: SSD 1 TB");
        assert!(field(&p, "Você pediu").is_none());
        assert!(field(&p, "Preço").is_some());
    }

    #[test]
    fn payload_target_without_target_value_and_store_skips_fields() {
        let c = EventCtx { store: "  ".into(), target_cents: None, url: None, ..Default::default() };
        let p = build_payload(&ev(AlertKind::Target, "Item"), &c);
        assert!(field(&p, "Você pediu").is_none());
        assert!(field(&p, "Loja").is_none());
        assert!(embed(&p).get("url").is_none());
    }

    #[test]
    fn payload_escapes_markdown_and_neutralizes_mentions() {
        let name = "**Cooler** _RGB_ [x](https://evil.com) `a` ~b~ |c| > d @everyone @here";
        let mut e = ev(AlertKind::Target, name);
        e.reason = "R$ 10,00 na Loja *X* @everyone (Pix).".into();
        let c = EventCtx { store: "Lo_ja [1]".into(), ..ctx() };
        let p = build_payload(&e, &c);
        let title = embed(&p)["title"].as_str().unwrap();
        assert!(title.starts_with("Chegou no preço: \\*\\*Cooler\\*\\* \\_RGB\\_ \\[x\\](https://evil.com)"), "{title}");
        assert!(!title.contains("@everyone") && !title.contains("@here"), "{title}");
        assert!(title.contains("@\u{200B}everyone"));
        let desc = embed(&p)["description"].as_str().unwrap();
        assert!(desc.contains("\\*X\\*") && desc.contains("@\u{200B}everyone"), "{desc}");
        assert_eq!(field(&p, "Loja").unwrap()["value"], "Lo\\_ja \\[1\\]");
        // mesmo assim, nenhuma menção é permitida
        assert_eq!(p["allowed_mentions"]["parse"], json!([]));
        assert!(p.get("content").is_none());
    }

    #[test]
    fn payload_newlines_and_long_names_are_bounded() {
        let long = "x".repeat(500);
        let p = build_payload(&ev(AlertKind::Target, &format!("a\nb\r\nc {long}")), &ctx());
        let title = embed(&p)["title"].as_str().unwrap();
        assert!(!title.contains('\n') && !title.contains('\r'));
        assert!(title.chars().count() <= 256, "{}", title.chars().count());
        assert!(title.ends_with('…'));
    }

    #[test]
    fn payload_mention_here_only_when_allowed() {
        let c = EventCtx { mention_here: true, ..ctx() };
        let p = build_payload(&ev(AlertKind::Target, "Item"), &c);
        assert_eq!(p["content"], "@here");
        assert_eq!(p["allowed_mentions"]["parse"], json!(["everyone"]));
    }

    #[test]
    fn payload_thumbnail_only_for_http_urls() {
        let mut c = ctx();
        c.image_url = Some("https://images.kabum.com.br/p.jpg".into());
        let p = build_payload(&ev(AlertKind::Target, "Item"), &c);
        assert_eq!(embed(&p)["thumbnail"]["url"], "https://images.kabum.com.br/p.jpg");
        for bad in ["C:\\Users\\x\\img.png", "file:///C:/img.png", "images/x.png", "javascript:alert(1)", ""] {
            c.image_url = Some(bad.into());
            let p = build_payload(&ev(AlertKind::Target, "Item"), &c);
            assert!(embed(&p).get("thumbnail").is_none(), "{bad}");
        }
        // link da oferta: mesmo critério
        c.url = Some("file:///etc/passwd".into());
        assert!(embed(&build_payload(&ev(AlertKind::Target, "Item"), &c)).get("url").is_none());
    }

    #[test]
    fn summary_payload_is_one_escaped_message() {
        let toast = Toast { title: "+4 itens no preço".into(), body: "A*, B_ e mais 1".into(), event_ids: vec!["e3".into(), "e4".into()] };
        let now = DateTime::parse_from_rfc3339("2026-11-08T15:00:00Z").unwrap().with_timezone(&Utc);
        let p = build_summary_payload(&toast, false, now);
        assert_eq!(p["embeds"].as_array().unwrap().len(), 1);
        assert_eq!(embed(&p)["title"], "+4 itens no preço");
        assert_eq!(embed(&p)["description"], "A\\*, B\\_ e mais 1");
        assert_eq!(embed(&p)["timestamp"], "2026-11-08T15:00:00Z");
        assert_eq!(p["allowed_mentions"]["parse"], json!([]));
        assert!(p.get("content").is_none());
        assert_eq!(build_summary_payload(&toast, true, now)["content"], "@here");
    }

    // ---- envio com transporte falso

    #[derive(Default)]
    struct Mock {
        replies: Mutex<VecDeque<Result<Reply, String>>>,
        sent: Mutex<Vec<(String, Value)>>,
        slept: Mutex<Vec<u64>>,
    }

    impl Mock {
        fn with(replies: Vec<Result<Reply, String>>) -> Mock {
            Mock { replies: Mutex::new(replies.into()), ..Default::default() }
        }
        fn ok() -> Result<Reply, String> {
            Ok(Reply { status: 204, body: String::new() })
        }
        fn status(s: u16, body: &str) -> Result<Reply, String> {
            Ok(Reply { status: s, body: body.into() })
        }
    }

    impl Transport for Mock {
        fn post(&self, url: &str, body: &str) -> Result<Reply, String> {
            self.sent.lock().unwrap().push((url.to_string(), serde_json::from_str(body).unwrap()));
            self.replies.lock().unwrap().pop_front().unwrap_or_else(Mock::ok)
        }
        fn sleep_ms(&self, ms: u64) {
            self.slept.lock().unwrap().push(ms);
        }
    }

    impl Transport for &Mock {
        fn post(&self, url: &str, body: &str) -> Result<Reply, String> {
            (**self).post(url, body)
        }
        fn sleep_ms(&self, ms: u64) {
            (**self).sleep_ms(ms)
        }
    }

    fn url() -> String {
        good("discord.com")
    }

    #[test]
    fn retry_once_on_429_respecting_retry_after() {
        let m = Mock::with(vec![Mock::status(429, r#"{"message":"rate limited","retry_after":0.5,"global":false}"#), Mock::ok()]);
        assert_eq!(post_with_retry(&m, &url(), &json!({})), Ok(()));
        assert_eq!(m.sent.lock().unwrap().len(), 2);
        assert_eq!(*m.slept.lock().unwrap(), vec![500]);
    }

    #[test]
    fn gives_up_when_retry_after_is_too_long_or_429_repeats() {
        let m = Mock::with(vec![Mock::status(429, r#"{"retry_after":6.0}"#)]);
        assert_eq!(post_with_retry(&m, &url(), &json!({})), Err(SendError::RateLimited(6000)));
        assert_eq!(m.sent.lock().unwrap().len(), 1);
        assert!(m.slept.lock().unwrap().is_empty());

        let m = Mock::with(vec![Mock::status(429, r#"{"retry_after":1}"#), Mock::status(429, r#"{"retry_after":1}"#), Mock::ok()]);
        assert!(matches!(post_with_retry(&m, &url(), &json!({})), Err(SendError::RateLimited(_))));
        assert_eq!(m.sent.lock().unwrap().len(), 2, "exactly one retry");

        // 429 sem corpo legível: espera padrão de 1 s
        let m = Mock::with(vec![Mock::status(429, "oops"), Mock::ok()]);
        assert_eq!(post_with_retry(&m, &url(), &json!({})), Ok(()));
        assert_eq!(*m.slept.lock().unwrap(), vec![1000]);
    }

    #[test]
    fn other_failures_do_not_retry() {
        for s in [400u16, 401, 404, 500, 503] {
            let m = Mock::with(vec![Mock::status(s, "")]);
            assert_eq!(post_with_retry(&m, &url(), &json!({})), Err(SendError::Status(s)));
            assert_eq!(m.sent.lock().unwrap().len(), 1);
        }
        let m = Mock::with(vec![Err("sem rede".into())]);
        assert_eq!(post_with_retry(&m, &url(), &json!({})), Err(SendError::Network("sem rede".into())));
        assert_eq!(m.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn friendly_errors_never_contain_the_url() {
        for e in [SendError::Status(404), SendError::Status(500), SendError::RateLimited(9000), SendError::Network("x".into())] {
            for text in [e.friendly(), e.to_string()] {
                assert!(!text.contains("webhooks") && !text.contains(TOKEN), "{text}");
            }
        }
    }

    fn many(n: usize) -> Vec<AlertEvent> {
        (1..=n)
            .map(|i| {
                let mut e = ev(AlertKind::Target, &format!("Item {i}"));
                e.id = format!("e{i}");
                e.title = format!("Chegou no preço: Item {i}");
                e
            })
            .collect()
    }

    fn channel<'a>(m: &'a Mock, events: &[AlertEvent], mention: bool) -> DiscordChannel<&'a Mock> {
        let map = events.iter().map(|e| (e.id.clone(), (e.clone(), EventCtx { mention_here: mention, ..ctx() }))).collect();
        DiscordChannel::new(parse_webhook(&url()).unwrap(), mention, map, m)
    }

    #[test]
    fn channel_sends_one_embed_per_event_and_one_summary_over_the_cap() {
        let evs = many(6);
        let m = Mock::default();
        let ch = channel(&m, &evs, false);
        let plan = alerts::plan_toasts(&evs, 3);
        let out = alerts::deliver(&[&ch], &plan);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].channel, "discord");
        assert_eq!(out[0].event_ids.len(), 6, "every event covered");
        let sent = m.sent.lock().unwrap();
        assert_eq!(sent.len(), 3, "cap respected: 2 embeds + 1 summary");
        assert!(sent.iter().all(|(u, _)| *u == url()));
        assert_eq!(sent[0].1["embeds"][0]["title"], "Chegou no preço: Item 1");
        assert!(sent[0].1["embeds"][0]["fields"].is_array(), "single event = full embed");
        assert_eq!(sent[2].1["embeds"][0]["title"], "+4 itens no preço");
        assert!(sent[2].1["embeds"][0].get("fields").is_none(), "summary is one plain message");
    }

    #[test]
    fn channel_failure_does_not_mark_delivered_and_does_not_stop_the_rest() {
        let evs = many(2);
        let m = Mock::with(vec![Mock::status(500, ""), Mock::ok()]);
        let ch = channel(&m, &evs, false);
        let out = alerts::deliver(&[&ch], &alerts::plan_toasts(&evs, 3));
        assert_eq!(out[0].event_ids, vec!["e2"], "failed event stays undelivered");
        assert_eq!(m.sent.lock().unwrap().len(), 2);
        // falha de rede: nada entregue
        let m = Mock::with(vec![Err("sem rede".into()), Err("sem rede".into())]);
        let ch = channel(&m, &evs, false);
        assert!(alerts::deliver(&[&ch], &alerts::plan_toasts(&evs, 3))[0].event_ids.is_empty());
    }

    #[test]
    fn channel_mentions_here_only_when_configured() {
        let evs = many(1);
        let m = Mock::default();
        channel(&m, &evs, true).send(&alerts::plan_toasts(&evs, 3)[0]).unwrap();
        assert_eq!(m.sent.lock().unwrap()[0].1["content"], "@here");
        let m = Mock::default();
        channel(&m, &evs, false).send(&alerts::plan_toasts(&evs, 3)[0]).unwrap();
        assert!(m.sent.lock().unwrap()[0].1.get("content").is_none());
    }

    #[test]
    fn send_test_posts_the_test_message_only() {
        let m = Mock::default();
        send_test(&m, &parse_webhook(&url()).unwrap()).unwrap();
        let sent = m.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].1["embeds"][0]["title"], "Aviso de teste");
        assert!(sent[0].1.get("content").is_none());
    }

    // ---- quem vai para o Discord

    fn on() -> ComprasSettings {
        ComprasSettings { discord_enabled: true, ..Default::default() }
    }

    #[test]
    fn wants_table() {
        let target = ev(AlertKind::Target, "A");
        let new_low = ev(AlertKind::NewLow, "A");
        let pending = AlertEvent { pending: true, ..ev(AlertKind::Target, "A") };
        let done = AlertEvent { delivered_discord: true, ..ev(AlertKind::Target, "A") };

        assert!(wants(&target, true, &on()), "enabled + toast");
        assert!(!wants(&target, true, &ComprasSettings::default()), "disabled by default");
        assert!(!wants(&target, false, &on()), "silent record (rule change / notify off)");
        assert!(!wants(&target, true, &ComprasSettings { notify_enabled: false, ..on() }), "master switch off");
        assert!(!wants(&done, true, &on()), "never twice");

        // novo menor preço
        assert!(wants(&new_low, true, &on()));
        assert!(!wants(&new_low, true, &ComprasSettings { discord_new_low: false, ..on() }));
        assert!(wants(&target, true, &ComprasSettings { discord_new_low: false, ..on() }), "target unaffected");

        // horário silencioso: pendente espera o flush quando respeita; vai direto quando não respeita
        assert!(!wants(&pending, false, &on()), "respect quiet hours (default): wait for flush");
        assert!(wants(&pending, false, &ComprasSettings { discord_respect_quiet_hours: false, ..on() }), "ignore quiet hours: immediate");
        // e o flush não repete o que já foi direto
        let sent_early = AlertEvent { delivered_discord: true, ..pending.clone() };
        assert!(!wants(&AlertEvent { pending: false, ..sent_early }, true, &ComprasSettings { discord_respect_quiet_hours: false, ..on() }));
        // flush depois do silêncio (toast = true, pending = false)
        assert!(wants(&AlertEvent { pending: false, ..pending }, true, &on()));
    }

    // ---- configurações

    #[test]
    fn settings_defaults_and_old_json() {
        let d = ComprasSettings::default();
        assert!(!d.discord_enabled && d.discord_new_low && d.discord_respect_quiet_hours);
        assert_eq!(d.discord_mention, "");
        // JSON antigo (sem campos do Discord) carrega e ganha os padrões, sem perder o resto
        let s: ComprasSettings = serde_json::from_str(r#"{"pixDiscountByStore":{"KaBuM":5.0},"notifyEnabled":false}"#).unwrap();
        assert_eq!(s.pix_discount_by_store.get("KaBuM"), Some(&5.0));
        assert!(!s.notify_enabled && !s.discord_enabled && s.discord_new_low && s.discord_respect_quiet_hours);
        // a UI manda camelCase
        let s: ComprasSettings = serde_json::from_str(r#"{"discordEnabled":true,"discordNewLow":false,"discordRespectQuietHours":false,"discordMention":"@here"}"#).unwrap();
        assert!(s.discord_enabled && !s.discord_new_low && !s.discord_respect_quiet_hours);
        assert_eq!(s.discord_mention, "@here");
    }

    #[test]
    fn saving_settings_sanitizes_the_mention_and_keeps_the_webhook_out() {
        let c = db::open_memory().unwrap();
        for (input, want) in [("@here", "@here"), (" @here ", "@here"), ("@everyone", ""), ("<@&123>", ""), ("", "")] {
            let saved = db::save_settings(&c, ComprasSettings { discord_enabled: true, discord_mention: input.into(), ..Default::default() }).unwrap();
            assert_eq!(saved.discord_mention, want, "{input:?}");
            assert_eq!(db::load_settings(&c).discord_mention, want);
        }
        // nada que pareça URL de webhook vai para o JSON de configurações
        let raw: String = c.query_row("SELECT value FROM settings WHERE key='settings'", [], |r| r.get(0)).unwrap();
        assert!(!raw.contains("webhooks") && !raw.contains("http"));
    }
}
