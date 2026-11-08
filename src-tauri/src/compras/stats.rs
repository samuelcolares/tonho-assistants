//! Estatísticas de preço (spec seção 6). Funções puras, testáveis sem banco.

use super::model::{CashSource, ItemStats, Trend};
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
}
