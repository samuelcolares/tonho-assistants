//! Estatísticas de preço (spec seção 6). Funções puras, testáveis sem banco.

use super::model::{CashSource, ItemStats, PriceRange, Trend, Verdict};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Utc};
use std::collections::BTreeMap;

/// Percentil com interpolação linear no rank `(n-1)*k`. `sorted` deve estar ordenado.
pub fn percentile(sorted: &[f64], k: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let n = sorted.len();
    if n == 1 {
        return Some(sorted[0]);
    }
    let rank = (n as f64 - 1.0) * k.clamp(0.0, 1.0);
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    let frac = rank - lo as f64;
    Some(sorted[lo] + (sorted[hi.min(n - 1)] - sorted[lo]) * frac)
}

pub fn mean(xs: &[f64]) -> Option<f64> {
    if xs.is_empty() {
        None
    } else {
        Some(xs.iter().sum::<f64>() / xs.len() as f64)
    }
}

/// Média dos valores dentro de [P25 - 1.5 IQR, P75 + 1.5 IQR].
pub fn trimmed_mean(sorted: &[f64]) -> Option<f64> {
    let p25 = percentile(sorted, 0.25)?;
    let p75 = percentile(sorted, 0.75)?;
    let iqr = p75 - p25;
    let lo = p25 - 1.5 * iqr;
    let hi = p75 + 1.5 * iqr;
    let kept: Vec<f64> = sorted.iter().copied().filter(|x| *x >= lo && *x <= hi).collect();
    mean(&kept)
}

/// Preço "à vista" efetivo de uma observação: preço de página, senão estimado
/// pelo desconto Pix (da oferta, senão da loja), senão o de lista.
pub fn effective_cash(
    list: Option<i64>,
    cash: Option<i64>,
    offer_pix_pct: Option<f64>,
    store_pix_pct: Option<f64>,
) -> (Option<i64>, Option<CashSource>) {
    if let Some(c) = cash {
        return (Some(c), Some(CashSource::Page));
    }
    let Some(l) = list else {
        return (None, None);
    };
    let pct = offer_pix_pct.or(store_pix_pct).filter(|p| *p > 0.0 && *p < 100.0);
    match pct {
        Some(p) => {
            let est = ((l as f64) * (1.0 - p / 100.0)).round() as i64;
            (Some(est), Some(CashSource::Estimated))
        }
        None => (Some(l), Some(CashSource::List)),
    }
}

/// Como `effective_cash`, respeitando a configuração "usar Pix": desligada, vale o preço de lista
/// (sem cash/Pix, nem estimado); sem lista, cai no preço de página.
pub fn effective_cash_basis(
    list: Option<i64>,
    cash: Option<i64>,
    offer_pix_pct: Option<f64>,
    store_pix_pct: Option<f64>,
    use_pix: bool,
) -> (Option<i64>, Option<CashSource>) {
    if use_pix {
        return effective_cash(list, cash, offer_pix_pct, store_pix_pct);
    }
    match (list, cash) {
        (Some(l), _) => (Some(l), Some(CashSource::List)),
        (None, Some(c)) => (Some(c), Some(CashSource::Page)),
        (None, None) => (None, None),
    }
}

/// Como `final_price`, respeitando a configuração "incluir frete" (desligada: final = à vista).
pub fn final_price_basis(effective_cash: Option<i64>, shipping: Option<i64>, include_shipping: bool) -> Option<i64> {
    final_price(effective_cash, if include_shipping { shipping } else { None })
}

/// final = à vista efetivo + frete (frete desconhecido conta 0).
pub fn final_price(effective_cash: Option<i64>, shipping: Option<i64>) -> Option<i64> {
    effective_cash.map(|c| c + shipping.unwrap_or(0))
}

/// Faixa de tempo em que um preço esteve visível (observação run-length).
#[derive(Debug, Clone)]
pub struct PricedSpan {
    pub offer_id: String,
    pub final_cents: i64,
    pub first: DateTime<Utc>,
    pub last: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DayPoint {
    pub best: i64,
    pub per_offer: BTreeMap<String, i64>,
}

/// Expande cada faixa em dias (fuso `tz`) e guarda o mínimo por dia, geral e por oferta.
pub fn daily_points(spans: &[PricedSpan], tz: FixedOffset) -> BTreeMap<NaiveDate, DayPoint> {
    let mut out: BTreeMap<NaiveDate, DayPoint> = BTreeMap::new();
    for s in spans {
        let d0 = s.first.with_timezone(&tz).date_naive();
        let d1 = s.last.with_timezone(&tz).date_naive().max(d0);
        let mut d = d0;
        // trava de segurança contra intervalos absurdos
        let mut guard = 0;
        while d <= d1 && guard < 20_000 {
            let e = out.entry(d).or_insert_with(|| DayPoint { best: s.final_cents, per_offer: BTreeMap::new() });
            if s.final_cents < e.best {
                e.best = s.final_cents;
            }
            let po = e.per_offer.entry(s.offer_id.clone()).or_insert(s.final_cents);
            if s.final_cents < *po {
                *po = s.final_cents;
            }
            d += Duration::days(1);
            guard += 1;
        }
    }
    out
}

fn round_opt(x: Option<f64>) -> Option<i64> {
    x.map(|v| v.round() as i64)
}

/// `series`: (dia, menor preço final do dia), ordenado por dia crescente.
pub fn compute_stats(
    series: &[(NaiveDate, i64)],
    today: NaiveDate,
    window_days: i64,
    current_final: Option<i64>,
    target: Option<i64>,
) -> ItemStats {
    let cutoff = today - Duration::days(window_days.max(0));
    let window: Vec<f64> = series.iter().filter(|(d, _)| *d >= cutoff).map(|(_, v)| *v as f64).collect();
    let mut sorted = window.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let all_time_low = series.iter().map(|(_, v)| *v).min();
    let median = percentile(&sorted, 0.5);
    let p25 = percentile(&sorted, 0.25);
    let p75 = percentile(&sorted, 0.75);
    let samples = window.len() as i64;

    let is_historical_low = match (current_final, all_time_low) {
        (Some(c), Some(low)) => c <= low && samples >= 2,
        _ => false,
    };
    let below_target = match (current_final, target) {
        (Some(c), Some(t)) => c <= t,
        _ => false,
    };
    let above_median = match (current_final, median) {
        (Some(c), Some(m)) => (c as f64) > m,
        _ => false,
    };

    ItemStats {
        window_days,
        samples,
        min_cents: sorted.first().map(|v| *v as i64),
        max_cents: sorted.last().map(|v| *v as i64),
        mean_cents: round_opt(mean(&sorted)),
        median_cents: round_opt(median),
        trimmed_mean_cents: round_opt(trimmed_mean(&sorted)),
        p25_cents: round_opt(p25),
        p75_cents: round_opt(p75),
        all_time_low_cents: all_time_low,
        current_final_cents: current_final,
        is_historical_low,
        below_target,
        above_median,
        trend: trend(series),
    }
}

/// Mínimo de amostras (dias com dado na janela) para dar um veredito.
pub const VERDICT_MIN_SAMPLES: i64 = 5;
/// Mínimo de dias entre o primeiro e o último dia com dado.
pub const VERDICT_MIN_SPAN_DAYS: i64 = 14;
pub const SPARKLINE_DAYS: usize = 30;

/// Dias entre o primeiro e o último dia com dado dentro da janela (0 sem dados).
pub fn window_span_days(series: &[(NaiveDate, i64)], today: NaiveDate, window_days: i64) -> i64 {
    let cutoff = today - Duration::days(window_days.max(0));
    let mut it = series.iter().filter(|(d, _)| *d >= cutoff).map(|(d, _)| *d);
    let Some(first) = it.next() else { return 0 };
    let last = it.last().unwrap_or(first);
    (last - first).num_days()
}

/// Veredito do preço atual. None sem preço atual. Aprendendo com poucas amostras ou período curto.
/// Baixo: atual <= P25. Alto: atual >= P75. Preço sem variação (P25 == P75 == atual) é normal.
pub fn verdict(samples: i64, span_days: i64, current: Option<i64>, p25: Option<i64>, p75: Option<i64>) -> Option<Verdict> {
    let cur = current?;
    if samples < VERDICT_MIN_SAMPLES || span_days < VERDICT_MIN_SPAN_DAYS {
        return Some(Verdict::Collecting);
    }
    let (Some(p25), Some(p75)) = (p25, p75) else { return Some(Verdict::Collecting) };
    if p25 == p75 && cur == p25 {
        return Some(Verdict::Normal);
    }
    Some(if cur <= p25 {
        Verdict::Low
    } else if cur >= p75 {
        Verdict::High
    } else {
        Verdict::Normal
    })
}

/// Faixa de 90 dias + atual. None sem preço atual ou sem amostras.
pub fn price_range(st: &ItemStats) -> Option<PriceRange> {
    Some(PriceRange {
        min_cents: st.min_cents?,
        p25_cents: st.p25_cents?,
        p75_cents: st.p75_cents?,
        max_cents: st.max_cents?,
        current_cents: st.current_final_cents?,
    })
}

/// `n` pontos diários terminando em `today` (inclusive). Carrega o último valor adiante
/// (inclusive o de antes da janela); None antes do primeiro dado. `series` ordenada por dia.
pub fn sparkline(series: &[(NaiveDate, i64)], today: NaiveDate, n: usize) -> Vec<Option<i64>> {
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let day = today - Duration::days((n - 1 - i) as i64);
        let v = series.iter().take_while(|(d, _)| *d <= day).last().map(|(_, v)| *v);
        out.push(v);
    }
    out
}

/// (MA7 - MA30) / MA30: < -2% desce, > +2% sobe, senão estável. None com < 7 pontos.
pub fn trend(series: &[(NaiveDate, i64)]) -> Option<Trend> {
    let n = series.len();
    if n < 7 {
        return None;
    }
    let last = |k: usize| -> f64 {
        let take = k.min(n);
        let sum: f64 = series[n - take..].iter().map(|(_, v)| *v as f64).sum();
        sum / take as f64
    };
    let ma7 = last(7);
    let ma30 = last(30);
    if ma30 <= 0.0 {
        return None;
    }
    let delta = (ma7 - ma30) / ma30;
    Some(if delta < -0.02 {
        Trend::Down
    } else if delta > 0.02 {
        Trend::Up
    } else {
        Trend::Flat
    })
}

/// Resultado da gravação de uma observação automática.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordOutcome {
    /// Estendeu a última observação (preço/estoque iguais).
    Extended,
    /// Nova observação confirmada.
    Inserted,
    /// Salto > 40%: guardada como não confirmada, oferta fica suspeita.
    Unconfirmed,
    /// Observação suspeita anterior confirmada por este poll (±2%).
    Confirmed,
}

/// Preço usado nas guardas: à vista de página, senão lista.
pub fn guard_price(list: Option<i64>, cash: Option<i64>) -> Option<i64> {
    cash.or(list)
}

/// |novo - base| / base > 40%
pub fn is_big_jump(base: i64, new: i64) -> bool {
    if base <= 0 {
        return false;
    }
    (new - base).abs() as f64 / base as f64 > 0.40
}

/// novo dentro de ±2% de ref
pub fn within_confirm_band(reference: i64, new: i64) -> bool {
    if reference <= 0 {
        return false;
    }
    (new - reference).abs() as f64 / reference as f64 <= 0.02
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
    }

    #[test]
    fn percentile_odd_and_even_median() {
        assert_eq!(percentile(&[1.0, 2.0, 3.0], 0.5), Some(2.0));
        assert_eq!(percentile(&[1.0, 2.0, 3.0, 4.0], 0.5), Some(2.5));
        assert_eq!(percentile(&[5.0], 0.5), Some(5.0));
        assert_eq!(percentile(&[], 0.5), None);
    }

    #[test]
    fn percentile_p25_interpolates() {
        // rank = 3 * 0.25 = 0.75 -> 10 + 0.75*(20-10) = 17.5
        let p = percentile(&[10.0, 20.0, 30.0, 40.0], 0.25).unwrap();
        assert!((p - 17.5).abs() < 1e-9);
        // n=5: rank 1.0 exato
        assert_eq!(percentile(&[1.0, 2.0, 3.0, 4.0, 5.0], 0.25), Some(2.0));
        assert_eq!(percentile(&[1.0, 2.0, 3.0, 4.0, 5.0], 0.75), Some(4.0));
    }

    #[test]
    fn trimmed_mean_drops_outlier() {
        // P25=2, P75=4, IQR=2 -> faixa [-1, 7]; o 100 sai
        let v = [1.0, 2.0, 3.0, 4.0, 5.0, 100.0];
        let tm = trimmed_mean(&v).unwrap();
        // percentis: rank 1.25 -> 2.25; rank 3.75 -> 4.75; IQR 2.5; hi = 8.5
        assert!((tm - 3.0).abs() < 1e-9, "tm = {tm}");
        let plain = mean(&v).unwrap();
        assert!(plain > 19.0);
    }

    #[test]
    fn compute_stats_window_and_alltime() {
        // 5 pontos recentes + 1 antigo (fora da janela de 90 d)
        let series = vec![
            (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), 50_000), // fora
            (d(1), 120_000),
            (d(2), 110_000),
            (d(3), 100_000),
            (d(4), 130_000),
            (d(5), 90_000),
        ];
        let st = compute_stats(&series, d(5), 90, Some(90_000), Some(95_000));
        assert_eq!(st.samples, 5);
        assert_eq!(st.min_cents, Some(90_000));
        assert_eq!(st.max_cents, Some(130_000));
        assert_eq!(st.mean_cents, Some(110_000));
        assert_eq!(st.median_cents, Some(110_000));
        assert_eq!(st.p25_cents, Some(100_000));
        assert_eq!(st.p75_cents, Some(120_000));
        assert_eq!(st.all_time_low_cents, Some(50_000));
        assert!(!st.is_historical_low); // all-time low é 50k
        assert!(st.below_target);
        assert!(!st.above_median);
    }

    #[test]
    fn historical_low_needs_two_samples() {
        let one = vec![(d(1), 100)];
        let st = compute_stats(&one, d(1), 90, Some(100), None);
        assert!(!st.is_historical_low);
        let two = vec![(d(1), 120), (d(2), 100)];
        let st = compute_stats(&two, d(2), 90, Some(100), None);
        assert!(st.is_historical_low);
        assert!(!st.below_target);
    }

    #[test]
    fn trend_needs_seven_points_and_detects_direction() {
        let flat: Vec<_> = (1..=6).map(|i| (d(i), 100)).collect();
        assert_eq!(trend(&flat), None);
        let down: Vec<_> = (1..=30).map(|i| (d(i), if i > 23 { 80 } else { 100 })).collect();
        assert_eq!(trend(&down), Some(Trend::Down));
        let up: Vec<_> = (1..=30).map(|i| (d(i), if i > 23 { 130 } else { 100 })).collect();
        assert_eq!(trend(&up), Some(Trend::Up));
        let stable: Vec<_> = (1..=30).map(|i| (d(i), 100)).collect();
        assert_eq!(trend(&stable), Some(Trend::Flat));
    }

    #[test]
    fn effective_cash_rules() {
        assert_eq!(effective_cash(Some(10000), Some(9000), Some(5.0), None), (Some(9000), Some(CashSource::Page)));
        assert_eq!(effective_cash(Some(10000), None, Some(5.0), None), (Some(9500), Some(CashSource::Estimated)));
        assert_eq!(effective_cash(Some(10000), None, None, Some(10.0)), (Some(9000), Some(CashSource::Estimated)));
        assert_eq!(effective_cash(Some(10000), None, None, None), (Some(10000), Some(CashSource::List)));
        assert_eq!(effective_cash(None, None, Some(5.0), None), (None, None));
    }

    #[test]
    fn final_is_cash_plus_shipping() {
        assert_eq!(final_price(Some(9500), Some(700)), Some(10200));
        assert_eq!(final_price(Some(9500), None), Some(9500));
        assert_eq!(final_price(None, Some(700)), None);
    }

    #[test]
    fn guards() {
        assert!(is_big_jump(10000, 5000));
        assert!(!is_big_jump(10000, 6100));
        assert!(is_big_jump(10000, 14100));
        assert!(!is_big_jump(10000, 14000));
        assert!(within_confirm_band(5000, 5100));
        assert!(!within_confirm_band(5000, 5200));
    }

    #[test]
    fn daily_points_expand_runs_and_take_min() {
        let tz = FixedOffset::east_opt(0).unwrap();
        let t = |day: u32, h: u32| Utc.with_ymd_and_hms(2026, 10, day, h, 0, 0).unwrap();
        use chrono::TimeZone;
        let spans = vec![
            PricedSpan { offer_id: "a".into(), final_cents: 100, first: t(1, 12), last: t(3, 12) },
            PricedSpan { offer_id: "b".into(), final_cents: 90, first: t(2, 12), last: t(2, 18) },
        ];
        let pts = daily_points(&spans, tz);
        assert_eq!(pts.len(), 3);
        assert_eq!(pts[&d(1)].best, 100);
        assert_eq!(pts[&d(2)].best, 90);
        assert_eq!(pts[&d(2)].per_offer["a"], 100);
        assert_eq!(pts[&d(3)].best, 100);
    }

    #[test]
    fn verdict_boundaries() {
        let v = |cur, p25, p75| verdict(10, 30, Some(cur), Some(p25), Some(p75));
        assert_eq!(v(100, 100, 200), Some(Verdict::Low)); // == p25
        assert_eq!(v(99, 100, 200), Some(Verdict::Low));
        assert_eq!(v(101, 100, 200), Some(Verdict::Normal));
        assert_eq!(v(199, 100, 200), Some(Verdict::Normal));
        assert_eq!(v(200, 100, 200), Some(Verdict::High)); // == p75
        assert_eq!(v(250, 100, 200), Some(Verdict::High));
        // sem variação: preço igual aos percentis é normal; abaixo ainda é baixo
        assert_eq!(v(100, 100, 100), Some(Verdict::Normal));
        assert_eq!(v(90, 100, 100), Some(Verdict::Low));
        assert_eq!(v(110, 100, 100), Some(Verdict::High));
    }

    #[test]
    fn verdict_none_without_current_and_collecting_rules() {
        assert_eq!(verdict(10, 30, None, Some(1), Some(2)), None);
        // amostras < 5
        assert_eq!(verdict(4, 30, Some(100), Some(100), Some(200)), Some(Verdict::Collecting));
        assert_eq!(verdict(5, 30, Some(100), Some(100), Some(200)), Some(Verdict::Low));
        // período < 14 dias
        assert_eq!(verdict(10, 13, Some(100), Some(100), Some(200)), Some(Verdict::Collecting));
        assert_eq!(verdict(10, 14, Some(100), Some(100), Some(200)), Some(Verdict::Low));
        // sem dados nenhum, mas com preço atual
        assert_eq!(verdict(0, 0, Some(100), None, None), Some(Verdict::Collecting));
    }

    #[test]
    fn window_span_ignores_points_outside_window() {
        assert_eq!(window_span_days(&[], d(30), 90), 0);
        assert_eq!(window_span_days(&[(d(5), 1)], d(30), 90), 0);
        assert_eq!(window_span_days(&[(d(5), 1), (d(19), 1)], d(30), 90), 14);
        let old = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        // ponto antigo fora da janela de 90 dias não conta
        assert_eq!(window_span_days(&[(old, 1), (d(5), 1), (d(7), 1)], d(30), 90), 2);
    }

    #[test]
    fn price_range_needs_samples_and_current() {
        let series: Vec<_> = (1..=5).map(|i| (d(i), 100 * i as i64)).collect();
        let st = compute_stats(&series, d(5), 90, Some(150), None);
        assert_eq!(
            price_range(&st),
            Some(PriceRange { min_cents: 100, p25_cents: 200, p75_cents: 400, max_cents: 500, current_cents: 150 })
        );
        let st = compute_stats(&series, d(5), 90, None, None);
        assert_eq!(price_range(&st), None);
        let st = compute_stats(&[], d(5), 90, Some(150), None);
        assert_eq!(price_range(&st), None);
    }

    #[test]
    fn sparkline_is_30_points_forward_filled() {
        let today = d(30);
        // dado só em 10 e 20; depois disso carrega o último valor até hoje
        let s = sparkline(&[(d(10), 100), (d(20), 80)], today, 30);
        assert_eq!(s.len(), 30);
        assert_eq!(s[0], None); // dia 1
        assert_eq!(s[8], None); // dia 9
        assert_eq!(s[9], Some(100)); // dia 10
        assert_eq!(s[18], Some(100)); // dia 19
        assert_eq!(s[19], Some(80)); // dia 20
        assert_eq!(s[29], Some(80)); // hoje
    }

    #[test]
    fn sparkline_seeds_from_before_window_and_handles_empty() {
        let old = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
        let s = sparkline(&[(old, 500)], d(30), 30);
        assert_eq!(s.len(), 30);
        assert!(s.iter().all(|v| *v == Some(500)));
        let e = sparkline(&[], d(30), 30);
        assert_eq!(e.len(), 30);
        assert!(e.iter().all(|v| v.is_none()));
        // dado só no futuro (relativo a hoje) fica nulo
        assert!(sparkline(&[(d(31), 1)], d(30), 30).iter().all(|v| v.is_none()));
    }

    #[test]
    fn price_basis_flags() {
        // usePix=true mantém o comportamento atual
        assert_eq!(effective_cash_basis(Some(10000), None, Some(5.0), None, true), (Some(9500), Some(CashSource::Estimated)));
        assert_eq!(effective_cash_basis(Some(10000), Some(9000), None, None, true), (Some(9000), Some(CashSource::Page)));
        // usePix=false: lista, ignora cash de página e desconto estimado
        assert_eq!(effective_cash_basis(Some(10000), Some(9000), Some(5.0), None, false), (Some(10000), Some(CashSource::List)));
        assert_eq!(effective_cash_basis(Some(10000), None, None, Some(10.0), false), (Some(10000), Some(CashSource::List)));
        // sem lista: cai no preço de página; sem nada: nada
        assert_eq!(effective_cash_basis(None, Some(9000), None, None, false), (Some(9000), Some(CashSource::Page)));
        assert_eq!(effective_cash_basis(None, None, None, None, false), (None, None));
        // includeShipping
        assert_eq!(final_price_basis(Some(9500), Some(700), true), Some(10200));
        assert_eq!(final_price_basis(Some(9500), Some(700), false), Some(9500));
        assert_eq!(final_price_basis(None, Some(700), false), None);
    }
}
