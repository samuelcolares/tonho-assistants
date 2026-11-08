//! Motor de avisos (Compras v2, P1).
//!
//! Camada pura (`decide`, `in_quiet_hours`, `reason_text`, `plan_toasts`, `deliver`) sem banco nem Tauri,
//! testável com tabelas; e `evaluate`, que liga a decisão ao SQLite (regra + evento gravados em transação).
//! Quem notifica (toast) é o chamador, sempre depois de gravar o evento e sem segurar o lock do banco.

use super::db;
use super::model::*;
use super::money;
use chrono::{DateTime, Duration, FixedOffset, NaiveTime, Utc};
use rusqlite::Connection;
use std::path::Path;

/// Queda mínima em reais para reavisar (além do percentual configurável): R$ 20,00.
pub const REALERT_DROP_CENTS: i64 = 2000;
/// Mínimo de dias com preço no histórico para valer "novo menor preço".
pub const NEW_LOW_MIN_SAMPLES: i64 = 5;

// ---------------------------------------------------------------- decisão (pura)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// Consulta automática gravada.
    Poll,
    /// Preço digitado.
    ManualPrice,
    /// Primeira consulta (prévia) de uma oferta nova.
    Seed,
    /// Alvo definido/alterado (ou aviso reativado): registra, mas sem toast.
    RuleChange,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub offer_id: String,
    pub store: String,
    pub final_cents: i64,
    pub estimated: bool,
    pub list_only: bool,
    pub shipping_known: bool,
}

#[derive(Debug, Clone)]
pub struct Policy {
    pub notify_enabled: bool,
    pub notify_new_low: bool,
    pub cooldown_hours: i64,
    pub realert_drop_pct: f64,
    pub realert_drop_cents: i64,
}

impl Policy {
    pub fn from_settings(s: &ComprasSettings) -> Policy {
        Policy {
            notify_enabled: s.notify_enabled,
            notify_new_low: s.notify_new_low,
            cooldown_hours: s.cooldown_hours,
            realert_drop_pct: s.realert_drop_pct,
            realert_drop_cents: REALERT_DROP_CENTS,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Input {
    pub now: DateTime<Utc>,
    pub trigger: Trigger,
    pub bought: bool,
    pub rule: Option<AlertRule>,
    /// Melhor oferta elegível (confirmada, status ok|manual, com estoque) já com o novo preço.
    pub candidate: Option<Candidate>,
    /// Melhor preço elegível antes desta atualização.
    pub prev_cents: Option<i64>,
    /// Menor preço da janela de 90 dias antes desta atualização.
    pub prior_low_cents: Option<i64>,
    /// Dias com preço no histórico antes desta atualização.
    pub history_samples: i64,
    pub quiet: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// Grava evento. `toast`: notificar agora. `pending`: notificar quando o horário silencioso acabar.
    Event { kind: AlertKind, toast: bool, pending: bool, also_new_low: bool },
    /// Preço voltou acima do alvo: limpa só `last_alert_cents` (`last_alert_at` mantém o cooldown).
    Rearm,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    pub effect: Effect,
    pub price_cents: i64,
    pub offer_id: String,
    pub prev_cents: Option<i64>,
}

fn snoozed(rule: &AlertRule, now: DateTime<Utc>) -> bool {
    rule.snooze_until
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc) > now)
        .unwrap_or(false)
}

fn cooldown_passed(rule: &AlertRule, now: DateTime<Utc>, hours: i64) -> bool {
    match rule.last_alert_at.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()) {
        Some(at) => now - at.with_timezone(&Utc) >= Duration::hours(hours.max(0)),
        None => true,
    }
}

/// Reaviso só com queda >= `realert_drop_pct` OU >= R$ 20 sobre o último preço avisado, E cooldown cumprido.
fn realert_ok(rule: &AlertRule, last: i64, cur: i64, now: DateTime<Utc>, policy: &Policy) -> bool {
    let drop = last - cur;
    if drop <= 0 || last <= 0 {
        return false;
    }
    let pct_ok = (drop as f64) * 100.0 / (last as f64) >= policy.realert_drop_pct - 1e-9;
    let abs_ok = drop >= policy.realert_drop_cents;
    (pct_ok || abs_ok) && cooldown_passed(rule, now, policy.cooldown_hours)
}

/// Decide o que fazer com o preço atual de um item. Nunca falha nem faz E/S.
pub fn decide(input: &Input, policy: &Policy) -> Option<Decision> {
    let rule = input.rule.as_ref()?;
    if !rule.enabled || input.bought || snoozed(rule, input.now) {
        return None;
    }
    let cand = input.candidate.as_ref()?;
    let cur = cand.final_cents;
    let mk = |effect: Effect| Decision { effect, price_cents: cur, offer_id: cand.offer_id.clone(), prev_cents: input.prev_cents };
    let target = rule.target_cents;
    let hit = target.map(|t| cur <= t).unwrap_or(false);

    // Alvo mexido pelo usuário: registra (sem toast) se o preço já está no alvo; senão nada.
    if input.trigger == Trigger::RuleChange {
        return hit.then(|| mk(Effect::Event { kind: AlertKind::Target, toast: false, pending: false, also_new_low: false }));
    }

    // Subiu acima do alvo depois de ter avisado: rearma.
    let rearmed = rule.last_alert_cents.is_some() && target.is_some() && !hit;
    let last = if rearmed { None } else { rule.last_alert_cents };
    // Sem último preço avisado (nunca avisou ou rearmou), o cooldown desde `last_alert_at` ainda vale:
    // preço oscilando em torno do alvo não pode furar o intervalo entre avisos.
    let gate_ok = match last {
        None => cooldown_passed(rule, input.now, policy.cooldown_hours),
        Some(l) => realert_ok(rule, l, cur, input.now, policy),
    };
    let new_low = policy.notify_new_low
        && rule.notify_new_low
        && input.history_samples >= NEW_LOW_MIN_SAMPLES
        && input.prior_low_cents.map(|p| cur < p).unwrap_or(false);

    let delivery = |kind: AlertKind, also_new_low: bool| {
        let quiet = input.quiet && policy.notify_enabled;
        Effect::Event {
            kind,
            toast: policy.notify_enabled && !input.quiet,
            pending: quiet,
            also_new_low,
        }
    };

    if hit {
        return gate_ok.then(|| mk(delivery(AlertKind::Target, new_low)));
    }
    if new_low && gate_ok {
        return Some(mk(delivery(AlertKind::NewLow, true)));
    }
    rearmed.then(|| mk(Effect::Rearm))
}

// ---------------------------------------------------------------- horário silencioso

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    let (h, m) = s.trim().split_once(':')?;
    NaiveTime::from_hms_opt(h.trim().parse().ok()?, m.trim().parse().ok()?, 0)
}

/// Normaliza "H:MM" para "HH:MM"; None se inválido.
pub fn normalize_hhmm(s: &str) -> Option<String> {
    parse_hhmm(s).map(|t| t.format("%H:%M").to_string())
}

/// `[start, end)`, atravessando a meia-noite quando `start > end`. Sem os dois horários (ou iguais) = desligado.
pub fn in_quiet_hours(local: NaiveTime, start: Option<&str>, end: Option<&str>) -> bool {
    let (Some(s), Some(e)) = (start.and_then(parse_hhmm), end.and_then(parse_hhmm)) else {
        return false;
    };
    if s == e {
        false
    } else if s < e {
        local >= s && local < e
    } else {
        local >= s || local < e
    }
}

// ---------------------------------------------------------------- textos

pub struct ReasonInfo {
    pub price_cents: i64,
    pub store: String,
    pub target_cents: Option<i64>,
    pub prev_cents: Option<i64>,
    pub estimated: bool,
    pub list_only: bool,
    pub shipping_known: bool,
    pub also_new_low: bool,
}

fn brl(c: i64) -> String {
    format!("R$ {}", money::format_brl(c))
}

/// "Pix + frete", "Pix, preço estimado + frete", "Pix, frete não informado", "preço de lista + frete"...
fn basis_text(r: &ReasonInfo) -> String {
    let cash = if r.list_only {
        "preço de lista"
    } else if r.estimated {
        "Pix, preço estimado"
    } else {
        "Pix"
    };
    let ship = if r.shipping_known { " + frete" } else { ", frete não informado" };
    format!("{cash}{ship}")
}

pub fn title_for(kind: AlertKind, item_name: &str) -> String {
    match kind {
        AlertKind::Target => format!("Chegou no preço: {item_name}"),
        AlertKind::NewLow => format!("Novo menor preço: {item_name}"),
        AlertKind::Restock => format!("Voltou ao estoque: {item_name}"),
    }
}

/// Corpo da notificação (e coluna `reason` do evento).
pub fn reason_text(kind: AlertKind, r: &ReasonInfo) -> String {
    match kind {
        AlertKind::Target => {
            let mut s = format!("{} na {} ({}).", brl(r.price_cents), r.store, basis_text(r));
            if let Some(t) = r.target_cents {
                s.push_str(&format!(" Você pediu {}.", brl(t)));
            }
            if r.also_new_low {
                s.push_str(" · menor preço dos últimos 90 dias");
            }
            s
        }
        AlertKind::NewLow => {
            let pct = r
                .prev_cents
                .filter(|p| *p > r.price_cents && *p > 0)
                .map(|p| ((p - r.price_cents) as f64 * 100.0 / p as f64).round() as i64)
                .filter(|n| *n >= 1);
            let mut s = match pct {
                Some(n) => format!("Caiu {n}%: {} na {}.", brl(r.price_cents), r.store),
                None => format!("Menor preço dos últimos 90 dias: {} na {}.", brl(r.price_cents), r.store),
            };
            if r.list_only {
                s.push_str(" Preço de lista.");
            } else if r.estimated {
                s.push_str(" Preço estimado.");
            }
            if !r.shipping_known {
                s.push_str(" Frete não informado.");
            }
            s
        }
        AlertKind::Restock => format!("Voltou ao estoque: {} na {}.", brl(r.price_cents), r.store),
    }
}

// ---------------------------------------------------------------- toasts e canais

#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub title: String,
    pub body: String,
    /// Eventos cobertos por esta notificação (marcados como entregues).
    pub event_ids: Vec<String>,
}

/// No máximo `max` notificações por ciclo. Passou disso: as primeiras `max - 1` saem sozinhas e o resto
/// vira uma só ("+N itens no preço"), então o total nunca passa de `max`.
pub fn plan_toasts(events: &[AlertEvent], max: usize) -> Vec<Toast> {
    let max = max.max(1);
    let single = |e: &AlertEvent| Toast { title: e.title.clone(), body: e.reason.clone(), event_ids: vec![e.id.clone()] };
    if events.len() <= max {
        return events.iter().map(single).collect();
    }
    let keep = max - 1;
    let mut out: Vec<Toast> = events[..keep].iter().map(single).collect();
    let rest = &events[keep..];
    let mut names: Vec<&str> = rest.iter().take(3).map(|e| e.item_name.as_str()).collect();
    let more = rest.len().saturating_sub(names.len());
    let mut body = names.drain(..).collect::<Vec<_>>().join(", ");
    if more > 0 {
        body.push_str(&format!(" e mais {more}"));
    }
    out.push(Toast {
        title: format!("+{} itens no preço", rest.len()),
        body,
        event_ids: rest.iter().map(|e| e.id.clone()).collect(),
    });
    out
}

/// Canal de entrega (desktop agora; Discord no P10).
pub trait AlertChannel: Send + Sync {
    /// "desktop" | "discord": define qual flag `delivered_*` o chamador grava.
    fn name(&self) -> &'static str;
    fn send(&self, toast: &Toast) -> Result<(), String>;
}

pub struct Delivery {
    pub channel: &'static str,
    pub event_ids: Vec<String>,
}

/// Envia cada toast por cada canal (melhor esforço: falha de um não impede os outros).
pub fn deliver(channels: &[&dyn AlertChannel], plan: &[Toast]) -> Vec<Delivery> {
    let mut out = Vec::new();
    for ch in channels {
        let mut ok_ids = Vec::new();
        for t in plan {
            match ch.send(t) {
                Ok(()) => ok_ids.extend(t.event_ids.iter().cloned()),
                Err(e) => eprintln!("[compras] aviso ({}) não enviado: {e}", ch.name()),
            }
        }
        out.push(Delivery { channel: ch.name(), event_ids: ok_ids });
    }
    out
}

/// Notificação nativa do Windows (mesmo mecanismo dos lembretes).
pub struct DesktopChannel {
    pub app: tauri::AppHandle,
}

impl AlertChannel for DesktopChannel {
    fn name(&self) -> &'static str {
        "desktop"
    }
    fn send(&self, toast: &Toast) -> Result<(), String> {
        use tauri_plugin_notification::NotificationExt;
        self.app
            .notification()
            .builder()
            .title(&toast.title)
            .body(&toast.body)
            .show()
            .map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------- integração com o banco

/// Estado de preço de um item, tirado antes de gravar uma atualização.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub price_cents: Option<i64>,
    pub low_cents: Option<i64>,
    pub samples: i64,
}

/// Oferta apta a disparar aviso: preço confirmado, status ok|manual, estoque não negativo.
pub fn eligible(v: &OfferView) -> bool {
    matches!(v.offer.status, OfferStatus::Ok | OfferStatus::Manual)
        && v.final_cents.is_some()
        && v.latest.as_ref().map(|l| l.confirmed && l.in_stock != Some(false)).unwrap_or(false)
}

pub fn candidate_of(view: &ItemView) -> Option<Candidate> {
    view.offers.iter().filter(|o| eligible(o)).min_by_key(|o| o.final_cents.unwrap_or(i64::MAX)).and_then(|o| {
        Some(Candidate {
            offer_id: o.offer.id.clone(),
            store: o.offer.store.clone(),
            final_cents: o.final_cents?,
            estimated: o.cash_source == Some(CashSource::Estimated),
            list_only: o.cash_source == Some(CashSource::List),
            shipping_known: o.shipping_known,
        })
    })
}

pub fn snapshot_of(view: &ItemView) -> Snapshot {
    Snapshot {
        price_cents: candidate_of(view).map(|c| c.final_cents),
        low_cents: view.stats.min_cents,
        samples: view.stats.samples,
    }
}

pub struct EvalCtx<'a> {
    pub now: DateTime<Utc>,
    pub tz: FixedOffset,
    pub settings: &'a ComprasSettings,
}

/// Evento recém-gravado e se deve virar toast agora.
#[derive(Debug, Clone)]
pub struct NewAlert {
    pub event: AlertEvent,
    pub toast: bool,
}

pub fn snapshot(conn: &Connection, item_id: &str, ctx: &EvalCtx) -> Option<Snapshot> {
    let today = ctx.now.with_timezone(&ctx.tz).date_naive();
    let views = db::load_views(conn, Some(item_id), ctx.settings, today, ctx.tz, Path::new(".")).ok()?;
    views.first().map(snapshot_of)
}

/// Avalia o item depois de uma atualização de preço ou de regra. Grava o evento (e o estado da regra)
/// em transação e devolve o que deve ser notificado; não notifica nada.
pub fn evaluate(conn: &Connection, item_id: &str, trigger: Trigger, before: Option<&Snapshot>, ctx: &EvalCtx) -> Result<Vec<NewAlert>, String> {
    let today = ctx.now.with_timezone(&ctx.tz).date_naive();
    let views = db::load_views(conn, Some(item_id), ctx.settings, today, ctx.tz, Path::new("."))?;
    let Some(view) = views.into_iter().next() else {
        return Ok(Vec::new());
    };
    let local = ctx.now.with_timezone(&ctx.tz).time();
    let input = Input {
        now: ctx.now,
        trigger,
        bought: view.item.bought,
        rule: view.alert.clone(),
        candidate: candidate_of(&view),
        prev_cents: before.and_then(|b| b.price_cents),
        prior_low_cents: before.and_then(|b| b.low_cents),
        history_samples: before.map(|b| b.samples).unwrap_or(0),
        quiet: in_quiet_hours(local, ctx.settings.quiet_start.as_deref(), ctx.settings.quiet_end.as_deref()),
    };
    let policy = Policy::from_settings(ctx.settings);
    let Some(decision) = decide(&input, &policy) else {
        return Ok(Vec::new());
    };
    let now_s = db::ts(ctx.now);
    match decision.effect {
        Effect::Rearm => {
            db::rearm_alert(conn, item_id)?;
            Ok(Vec::new())
        }
        Effect::Event { kind, toast, pending, also_new_low } => {
            let cand = input.candidate.as_ref();
            let reason = reason_text(
                kind,
                &ReasonInfo {
                    price_cents: decision.price_cents,
                    store: cand.map(|c| c.store.clone()).unwrap_or_default(),
                    target_cents: input.rule.as_ref().and_then(|r| r.target_cents),
                    prev_cents: decision.prev_cents.or(input.prior_low_cents),
                    estimated: cand.map(|c| c.estimated).unwrap_or(false),
                    list_only: cand.map(|c| c.list_only).unwrap_or(false),
                    shipping_known: cand.map(|c| c.shipping_known).unwrap_or(true),
                    also_new_low,
                },
            );
            let event = AlertEvent {
                id: uuid::Uuid::new_v4().to_string(),
                item_id: item_id.to_string(),
                offer_id: Some(decision.offer_id.clone()),
                kind,
                price_cents: decision.price_cents,
                prev_cents: decision.prev_cents.or(input.prior_low_cents),
                reason,
                created_at: now_s.clone(),
                pending,
                seen: false,
                delivered_desktop: false,
                delivered_discord: false,
                item_name: view.item.name.clone(),
                title: title_for(kind, &view.item.name),
            };
            // evento ANTES de notificar; estado da regra na mesma transação
            let tx = conn.unchecked_transaction().map_err(db::dberr)?;
            db::insert_event(&tx, &event)?;
            db::set_alert_state(&tx, item_id, Some(decision.price_cents), Some(&now_s))?;
            tx.commit().map_err(db::dberr)?;
            Ok(vec![NewAlert { event, toast }])
        }
    }
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t0() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 8, 15, 0, 0).unwrap()
    }
    fn ts_ago(h: i64) -> String {
        db::ts(t0() - Duration::hours(h))
    }
    fn cand(final_cents: i64) -> Candidate {
        Candidate { offer_id: "o1".into(), store: "KaBuM".into(), final_cents, estimated: false, list_only: false, shipping_known: true }
    }
    fn rule() -> AlertRule {
        AlertRule { item_id: "i1".into(), enabled: true, target_cents: Some(100_000), notify_new_low: true, ..Default::default() }
    }
    fn input() -> Input {
        Input {
            now: t0(),
            trigger: Trigger::Poll,
            bought: false,
            rule: Some(rule()),
            candidate: Some(cand(95_000)),
            prev_cents: Some(105_000),
            prior_low_cents: Some(90_000),
            history_samples: 10,
            quiet: false,
        }
    }
    fn policy() -> Policy {
        Policy::from_settings(&ComprasSettings::default())
    }
    fn fire(kind: AlertKind) -> Effect {
        Effect::Event { kind, toast: true, pending: false, also_new_low: false }
    }
    fn effect(i: &Input) -> Option<Effect> {
        decide(i, &policy()).map(|d| d.effect)
    }
    fn with_last(i: &mut Input, last: i64, hours_ago: i64) {
        let r = i.rule.as_mut().unwrap();
        r.last_alert_cents = Some(last);
        r.last_alert_at = Some(ts_ago(hours_ago));
    }

    #[test]
    fn decide_table() {
        type Case = (&'static str, fn(&mut Input), Option<Effect>);
        let cases: &[Case] = &[
            ("crossing fires once", |_| {}, Some(fire(AlertKind::Target))),
            ("price above target: nothing", |i| i.candidate = Some(cand(110_000)), None),
            ("exactly at target fires", |i| i.candidate = Some(cand(100_000)), Some(fire(AlertKind::Target))),
            ("no candidate (unconfirmed/suspect/blocked/out of stock): nothing", |i| i.candidate = None, None),
            ("equal to last alert: no repeat", |i| with_last(i, 95_000, 48), None),
            ("higher than last, still under target: no repeat", |i| {
                with_last(i, 93_000, 48);
                i.candidate = Some(cand(95_000));
            }, None),
            ("drop 1% / R$10 after cooldown: no re-alert", |i| {
                with_last(i, 95_000, 48);
                i.candidate = Some(cand(94_000));
            }, None),
            ("drop >= 3% after cooldown: re-alert", |i| {
                with_last(i, 95_000, 48);
                i.candidate = Some(cand(92_000));
            }, Some(fire(AlertKind::Target))),
            ("drop exactly 3%: re-alert", |i| {
                with_last(i, 100_000, 48);
                i.candidate = Some(cand(97_000));
            }, Some(fire(AlertKind::Target))),
            ("drop >= R$20 but < 3%: re-alert", |i| {
                i.rule.as_mut().unwrap().target_cents = Some(1_200_000);
                with_last(i, 1_000_000, 48);
                i.candidate = Some(cand(978_000));
            }, Some(fire(AlertKind::Target))),
            ("big drop but cooldown not passed: nothing", |i| {
                with_last(i, 95_000, 2);
                i.candidate = Some(cand(80_000));
            }, None),
            ("rise above target re-arms", |i| {
                with_last(i, 95_000, 48);
                i.candidate = Some(cand(110_000));
            }, Some(Effect::Rearm)),
            ("after re-arm, inside cooldown: nothing (bounce can't bypass cooldown)", |i| {
                let r = i.rule.as_mut().unwrap();
                r.last_alert_cents = None;
                r.last_alert_at = Some(ts_ago(2));
            }, None),
            ("after re-arm, cooldown passed: fires", |i| {
                let r = i.rule.as_mut().unwrap();
                r.last_alert_cents = None;
                r.last_alert_at = Some(ts_ago(25));
            }, Some(fire(AlertKind::Target))),
            ("never alerted: fires", |i| {
                let r = i.rule.as_mut().unwrap();
                r.last_alert_cents = None;
                r.last_alert_at = None;
            }, Some(fire(AlertKind::Target))),
            ("new low inside cooldown after re-arm: nothing", |i| {
                let r = i.rule.as_mut().unwrap();
                r.last_alert_cents = None;
                r.last_alert_at = Some(ts_ago(2));
                i.candidate = Some(cand(110_000));
                i.prior_low_cents = Some(120_000);
            }, None),
            ("disabled rule: nothing", |i| i.rule.as_mut().unwrap().enabled = false, None),
            ("no rule: nothing", |i| i.rule = None, None),
            ("bought: nothing", |i| i.bought = true, None),
            ("snoozed: nothing", |i| i.rule.as_mut().unwrap().snooze_until = Some(db::ts(t0() + Duration::days(3))), None),
            ("snooze expired: fires", |i| i.rule.as_mut().unwrap().snooze_until = Some(db::ts(t0() - Duration::hours(1))), Some(fire(AlertKind::Target))),
            ("quiet hours: pending, no toast", |i| i.quiet = true, Some(Effect::Event { kind: AlertKind::Target, toast: false, pending: true, also_new_low: false })),
            ("target also new low: flagged", |i| {
                i.candidate = Some(cand(85_000));
                i.prior_low_cents = Some(90_000);
            }, Some(Effect::Event { kind: AlertKind::Target, toast: true, pending: false, also_new_low: true })),
            ("new low without target needs rule flag", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                i.rule.as_mut().unwrap().notify_new_low = false;
                i.candidate = Some(cand(85_000));
            }, None),
            ("new low without target fires", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                i.candidate = Some(cand(85_000));
            }, Some(Effect::Event { kind: AlertKind::NewLow, toast: true, pending: false, also_new_low: true })),
            ("new low needs samples >= 5 (4 -> nothing)", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                i.candidate = Some(cand(85_000));
                i.history_samples = 4;
            }, None),
            ("new low with exactly 5 samples fires", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                i.candidate = Some(cand(85_000));
                i.history_samples = 5;
            }, Some(Effect::Event { kind: AlertKind::NewLow, toast: true, pending: false, also_new_low: true })),
            ("equal to previous low is not a new low", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                i.candidate = Some(cand(90_000));
            }, None),
            ("new low while above target, after earlier alert: re-arms and fires", |i| {
                i.rule.as_mut().unwrap().target_cents = Some(50_000);
                with_last(i, 49_000, 48);
                i.candidate = Some(cand(85_000));
            }, Some(Effect::Event { kind: AlertKind::NewLow, toast: true, pending: false, also_new_low: true })),
            ("new low blocked by cooldown (no target)", |i| {
                i.rule.as_mut().unwrap().target_cents = None;
                with_last(i, 89_000, 1);
                i.candidate = Some(cand(85_000));
            }, None),
            ("rule change, price already at target: silent event", |i| i.trigger = Trigger::RuleChange,
                Some(Effect::Event { kind: AlertKind::Target, toast: false, pending: false, also_new_low: false })),
            ("rule change, quiet hours still silent and not pending", |i| {
                i.trigger = Trigger::RuleChange;
                i.quiet = true;
            }, Some(Effect::Event { kind: AlertKind::Target, toast: false, pending: false, also_new_low: false })),
            ("rule change, price above target: nothing", |i| {
                i.trigger = Trigger::RuleChange;
                i.candidate = Some(cand(130_000));
            }, None),
            ("rule change never fires new low", |i| {
                i.trigger = Trigger::RuleChange;
                i.rule.as_mut().unwrap().target_cents = None;
                i.candidate = Some(cand(85_000));
            }, None),
            ("manual price and seed behave like poll", |i| i.trigger = Trigger::ManualPrice, Some(fire(AlertKind::Target))),
        ];
        for (name, tweak, want) in cases {
            let mut i = input();
            tweak(&mut i);
            assert_eq!(&effect(&i), want, "case: {name}");
        }
    }

    #[test]
    fn notifications_off_records_without_toast_or_pending() {
        let mut p = policy();
        p.notify_enabled = false;
        let mut i = input();
        i.quiet = true;
        let d = decide(&i, &p).unwrap();
        assert_eq!(d.effect, Effect::Event { kind: AlertKind::Target, toast: false, pending: false, also_new_low: false });
        i.quiet = false;
        let d = decide(&i, &p).unwrap();
        assert_eq!(d.effect, Effect::Event { kind: AlertKind::Target, toast: false, pending: false, also_new_low: false });
    }

    #[test]
    fn global_new_low_switch_blocks_new_low() {
        let mut p = policy();
        p.notify_new_low = false;
        let mut i = input();
        i.rule.as_mut().unwrap().target_cents = None;
        i.candidate = Some(cand(85_000));
        assert_eq!(decide(&i, &p), None);
    }

    #[test]
    fn decision_carries_offer_and_prices() {
        let d = decide(&input(), &policy()).unwrap();
        assert_eq!((d.price_cents, d.offer_id.as_str(), d.prev_cents), (95_000, "o1", Some(105_000)));
    }

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn quiet_hours_table() {
        let night = (Some("22:00"), Some("08:00"));
        let day = (Some("13:00"), Some("15:00"));
        let cases = [
            (t(23, 0), night, true),
            (t(22, 0), night, true),
            (t(0, 0), night, true),
            (t(7, 59), night, true),
            (t(8, 0), night, false),
            (t(12, 0), night, false),
            (t(21, 59), night, false),
            (t(13, 0), day, true),
            (t(14, 59), day, true),
            (t(15, 0), day, false),
            (t(3, 0), day, false),
            (t(23, 0), (None, Some("08:00")), false),
            (t(23, 0), (Some("22:00"), None), false),
            (t(23, 0), (None, None), false),
            (t(23, 0), (Some("22:00"), Some("22:00")), false),
            (t(23, 0), (Some("lixo"), Some("08:00")), false),
            (t(23, 0), (Some("6:30"), Some("23:30")), true),
        ];
        for (now, (s, e), want) in cases {
            assert_eq!(in_quiet_hours(now, s, e), want, "{now} {s:?}-{e:?}");
        }
        assert_eq!(normalize_hhmm("6:05").as_deref(), Some("06:05"));
        assert_eq!(normalize_hhmm("25:00"), None);
    }

    fn info() -> ReasonInfo {
        ReasonInfo { price_cents: 115_000, store: "KaBuM".into(), target_cents: Some(120_000), prev_cents: Some(130_000), estimated: false, list_only: false, shipping_known: true, also_new_low: false }
    }

    #[test]
    fn reason_texts() {
        assert_eq!(reason_text(AlertKind::Target, &info()), "R$ 1.150,00 na KaBuM (Pix + frete). Você pediu R$ 1.200,00.");
        let mut i = info();
        i.also_new_low = true;
        assert!(reason_text(AlertKind::Target, &i).ends_with(" · menor preço dos últimos 90 dias"));
        let mut i = info();
        i.estimated = true;
        assert!(reason_text(AlertKind::Target, &i).contains("preço estimado"));
        let mut i = info();
        i.shipping_known = false;
        assert!(reason_text(AlertKind::Target, &i).contains("frete não informado"));
        assert_eq!(reason_text(AlertKind::NewLow, &info()), "Caiu 12%: R$ 1.150,00 na KaBuM.");
        let mut i = info();
        i.prev_cents = None;
        i.estimated = true;
        i.shipping_known = false;
        assert_eq!(
            reason_text(AlertKind::NewLow, &i),
            "Menor preço dos últimos 90 dias: R$ 1.150,00 na KaBuM. Preço estimado. Frete não informado."
        );
        assert_eq!(title_for(AlertKind::Target, "Geladeira"), "Chegou no preço: Geladeira");
        assert_eq!(title_for(AlertKind::NewLow, "Geladeira"), "Novo menor preço: Geladeira");
    }

    fn ev(n: usize) -> AlertEvent {
        AlertEvent {
            id: format!("e{n}"),
            item_id: format!("i{n}"),
            offer_id: None,
            kind: AlertKind::Target,
            price_cents: 1000,
            prev_cents: None,
            reason: format!("motivo {n}"),
            created_at: String::new(),
            pending: false,
            seen: false,
            delivered_desktop: false,
            delivered_discord: false,
            item_name: format!("Item {n}"),
            title: format!("Chegou no preço: Item {n}"),
        }
    }

    #[test]
    fn toast_cap_and_summary() {
        let evs: Vec<AlertEvent> = (1..=6).map(ev).collect();
        assert_eq!(plan_toasts(&[], 3).len(), 0);
        let three = plan_toasts(&evs[..3], 3);
        assert_eq!(three.len(), 3);
        assert_eq!(three[0].title, "Chegou no preço: Item 1");
        let six = plan_toasts(&evs, 3);
        assert_eq!(six.len(), 3, "total never above the cap");
        assert_eq!(six[2].title, "+4 itens no preço");
        assert_eq!(six[2].event_ids, vec!["e3", "e4", "e5", "e6"]);
        assert_eq!(six[2].body, "Item 3, Item 4, Item 5 e mais 1");
        let all: usize = six.iter().map(|x| x.event_ids.len()).sum();
        assert_eq!(all, 6, "every event covered by some toast");
        let one = plan_toasts(&evs[..4], 1);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].title, "+4 itens no preço");
        assert_eq!(plan_toasts(&evs[..2], 0).len(), 1, "cap floors at 1");
    }

    struct Fake {
        fail_on: Option<String>,
        sent: std::sync::Mutex<Vec<String>>,
    }
    impl AlertChannel for Fake {
        fn name(&self) -> &'static str {
            "desktop"
        }
        fn send(&self, toast: &Toast) -> Result<(), String> {
            if self.fail_on.as_deref() == Some(toast.title.as_str()) {
                return Err("falhou".into());
            }
            self.sent.lock().unwrap().push(toast.title.clone());
            Ok(())
        }
    }

    #[test]
    fn deliver_is_best_effort() {
        let evs: Vec<AlertEvent> = (1..=2).map(ev).collect();
        let plan = plan_toasts(&evs, 3);
        let ch = Fake { fail_on: Some(plan[0].title.clone()), sent: Default::default() };
        let out = deliver(&[&ch], &plan);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].channel, "desktop");
        assert_eq!(out[0].event_ids, vec!["e2"]);
        assert_eq!(ch.sent.lock().unwrap().len(), 1);
    }

    // ---- candidatos elegíveis

    fn offer_view(status: OfferStatus, in_stock: Option<bool>, confirmed: bool) -> OfferView {
        let offer = ComprasOffer {
            id: "o1".into(),
            item_id: "i1".into(),
            store: "KaBuM".into(),
            url: None,
            title: None,
            sku: None,
            adapter: OfferAdapter::Generic,
            shipping_cents: Some(0),
            shipping_note: None,
            pix_discount_pct: None,
            status,
            fail_count: 0,
            last_error: None,
            last_checked_at: None,
            next_poll_at: None,
            created_at: String::new(),
        };
        let obs = ComprasObservation {
            id: "b1".into(),
            offer_id: "o1".into(),
            list_cents: Some(100_000),
            cash_cents: Some(95_000),
            installments_text: None,
            in_stock,
            source: ObsSource::Auto,
            confirmed,
            first_seen_at: String::new(),
            last_seen_at: String::new(),
            error: None,
        };
        db::offer_view(offer, Some(obs), &ComprasSettings::default())
    }

    #[test]
    fn eligibility_table() {
        use OfferStatus::*;
        let cases = [
            (Ok, Some(true), true, true),
            (Ok, None, true, true),
            (Manual, Some(true), true, true),
            (Ok, Some(false), true, false),
            (Ok, Some(true), false, false),
            (Suspect, Some(true), true, false),
            (Blocked, Some(true), true, false),
            (Broken, Some(true), true, false),
            (Pending, Some(true), true, false),
            (Paused, Some(true), true, false),
        ];
        for (st, stock, conf, want) in cases {
            assert_eq!(eligible(&offer_view(st, stock, conf)), want, "{st:?} {stock:?} {conf}");
        }
    }

    // ---- integração com o banco (em memória)

    fn setup() -> (Connection, String, String) {
        let c = db::open_memory().unwrap();
        let item = db::upsert_item(
            &c,
            ComprasItem {
                id: String::new(),
                category: "Eletros".into(),
                name: "Geladeira".into(),
                qty: 1,
                budget_unit_cents: Some(300_000),
                target_cents: None,
                notes: String::new(),
                bought: false,
                image_path: None,
                specs: Default::default(),
                template_id: None,
                model_token: None,
                priority: 0,
                created_at: String::new(),
                updated_at: String::new(),
            },
            "2026-10-01T12:00:00Z",
        )
        .unwrap();
        let offer = db::upsert_offer(
            &c,
            ComprasOffer {
                id: String::new(),
                item_id: item.id.clone(),
                store: "Loja".into(),
                url: None,
                title: None,
                sku: None,
                adapter: OfferAdapter::Manual,
                shipping_cents: Some(0),
                shipping_note: None,
                pix_discount_pct: None,
                status: OfferStatus::Manual,
                fail_count: 0,
                last_error: None,
                last_checked_at: None,
                next_poll_at: None,
                created_at: String::new(),
            },
            "2026-10-01T12:00:00Z",
        )
        .unwrap();
        (c, item.id, offer.id)
    }

    fn ctx<'a>(settings: &'a ComprasSettings, hour: u32) -> EvalCtx<'a> {
        EvalCtx { now: Utc.with_ymd_and_hms(2026, 11, 8, hour, 0, 0).unwrap(), tz: FixedOffset::east_opt(0).unwrap(), settings }
    }

    #[test]
    fn evaluate_end_to_end_cross_repeat_rearm() {
        let (c, item, offer) = setup();
        let mut s = ComprasSettings::default();
        s.quiet_start = None;
        s.quiet_end = None;
        let (rule, eval) = db::apply_rule_edit(&c, AlertRule { item_id: item.clone(), target_cents: Some(250_000), ..Default::default() }, "2026-11-08T00:00:00Z").unwrap();
        assert_eq!(rule.target_cents, Some(250_000));
        assert!(eval);
        assert_eq!(db::get_item(&c, &item).unwrap().unwrap().target_cents, Some(250_000), "item.target_cents kept in sync");

        // acima do alvo: nada
        let k = ctx(&s, 12);
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(260_000), Some(true), "2026-11-08T12:00:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap().is_empty());

        // cruza: 1 evento com toast, texto com o alvo
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(240_000), Some(true), "2026-11-08T12:01:00Z").unwrap();
        let out = evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].toast);
        assert_eq!(out[0].event.kind, AlertKind::Target);
        assert_eq!(out[0].event.prev_cents, Some(260_000));
        assert!(out[0].event.reason.contains("R$ 2.400,00") && out[0].event.reason.contains("Você pediu R$ 2.500,00"));
        assert_eq!(db::list_events(&c, 10, false).unwrap().len(), 1);
        let r = db::get_rule(&c, &item).unwrap().unwrap();
        assert_eq!(r.last_alert_cents, Some(240_000));

        // mesmo preço de novo: nada
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(240_000), Some(true), "2026-11-08T12:02:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap().is_empty());

        // sobe: rearma (limpa só last_alert_cents; last_alert_at mantém o cooldown)
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(270_000), Some(true), "2026-11-08T12:03:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap().is_empty());
        let r = db::get_rule(&c, &item).unwrap().unwrap();
        assert_eq!(r.last_alert_cents, None);
        assert!(r.last_alert_at.is_some(), "cooldown timestamp survives re-arm");

        // cruza de novo dentro do cooldown (oscilação): NÃO avisa
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(245_000), Some(true), "2026-11-08T12:04:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap().is_empty());
        assert_eq!(db::list_events(&c, 10, false).unwrap().len(), 1);

        // sobe e cruza de novo depois do cooldown (>= 24h): avisa
        let k2 = EvalCtx { now: k.now + Duration::hours(25), tz: k.tz, settings: k.settings };
        let before = snapshot(&c, &item, &k2);
        db::add_manual_price(&c, &offer, None, Some(280_000), Some(true), "2026-11-09T13:00:00Z").unwrap();
        evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k2).unwrap();
        let before = snapshot(&c, &item, &k2);
        db::add_manual_price(&c, &offer, None, Some(245_000), Some(true), "2026-11-09T13:05:00Z").unwrap();
        assert_eq!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k2).unwrap().len(), 1);
        assert_eq!(db::list_events(&c, 10, false).unwrap().len(), 2);
    }

    #[test]
    fn evaluate_quiet_hours_marks_pending_and_out_of_stock_never_fires() {
        let (c, item, offer) = setup();
        let s = ComprasSettings::default(); // 22:00-08:00
        db::apply_rule_edit(&c, AlertRule { item_id: item.clone(), target_cents: Some(250_000), ..Default::default() }, "2026-11-08T00:00:00Z").unwrap();
        let k = ctx(&s, 23);

        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(200_000), Some(false), "2026-11-08T23:00:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap().is_empty(), "sem estoque nunca avisa");

        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(200_000), Some(true), "2026-11-08T23:01:00Z").unwrap();
        let out = evaluate(&c, &item, Trigger::ManualPrice, before.as_ref(), &k).unwrap();
        assert_eq!(out.len(), 1);
        assert!(!out[0].toast && out[0].event.pending);
        let pend = db::take_pending_events(&c).unwrap();
        assert_eq!(pend.len(), 1);
        assert!(db::take_pending_events(&c).unwrap().is_empty(), "pendentes só saem uma vez");
        assert!(!db::list_events(&c, 10, false).unwrap()[0].pending);
    }

    #[test]
    fn target_set_when_price_already_below_records_silent_event() {
        let (c, item, offer) = setup();
        let mut s = ComprasSettings::default();
        s.quiet_start = None;
        s.quiet_end = None;
        db::add_manual_price(&c, &offer, None, Some(200_000), Some(true), "2026-11-08T11:00:00Z").unwrap();
        let (_, eval) = db::apply_rule_edit(&c, AlertRule { item_id: item.clone(), target_cents: Some(250_000), ..Default::default() }, "2026-11-08T12:00:00Z").unwrap();
        assert!(eval);
        let out = evaluate(&c, &item, Trigger::RuleChange, None, &ctx(&s, 12)).unwrap();
        assert_eq!(out.len(), 1);
        assert!(!out[0].toast && !out[0].event.pending && !out[0].event.seen);
        // mesmo alvo reaplicado não reavalia
        let (_, eval2) = db::apply_rule_edit(&c, AlertRule { item_id: item.clone(), target_cents: Some(250_000), ..Default::default() }, "2026-11-08T12:05:00Z").unwrap();
        assert!(!eval2);
        // próximo poll com o mesmo preço: sem toast (estado já registrado)
        let k = ctx(&s, 13);
        let before = snapshot(&c, &item, &k);
        db::add_manual_price(&c, &offer, None, Some(200_000), Some(true), "2026-11-08T13:00:00Z").unwrap();
        assert!(evaluate(&c, &item, Trigger::Poll, before.as_ref(), &k).unwrap().is_empty());
    }
}
