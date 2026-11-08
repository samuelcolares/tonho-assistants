//! Matemática do agendador (pura, com `now` e aleatório injetados).

use super::model::{ComprasSettings, OfferAdapter};
use chrono::{DateTime, Duration, Utc};
use std::sync::atomic::{AtomicU64, Ordering};

pub const MIN_INTERVAL_MIN: i64 = 60;
pub const MAX_INTERVAL_MIN: i64 = 180;
pub const JITTER: f64 = 0.15;
pub const BACKOFF_CAP_SECS: i64 = 24 * 3600;

/// Intervalo-base (minutos) de uma oferta: configurado (60..180); Amazon respeita o mínimo próprio.
pub fn interval_minutes(settings: &ComprasSettings, adapter: OfferAdapter) -> i64 {
    let base = settings.poll_interval_minutes.clamp(MIN_INTERVAL_MIN, MAX_INTERVAL_MIN);
    if adapter == OfferAdapter::Amazon {
        base.max(settings.amazon_min_interval_minutes.max(1))
    } else {
        base
    }
}

/// `rand01` em [0,1): resultado em [0.85, 1.15) x intervalo.
pub fn jittered_secs(interval_minutes: i64, rand01: f64) -> i64 {
    let r = rand01.clamp(0.0, 1.0);
    let factor = 1.0 + (r * 2.0 - 1.0) * JITTER;
    ((interval_minutes.max(1) * 60) as f64 * factor).round() as i64
}

/// `interval x 2^falhas`, com teto de 24 h.
pub fn backoff_secs(interval_minutes: i64, fail_count: i64) -> i64 {
    let exp = fail_count.clamp(0, 20) as u32;
    let base = interval_minutes.max(1) * 60;
    base.saturating_mul(1i64 << exp).min(BACKOFF_CAP_SECS)
}

/// Próxima consulta: sem falhas -> intervalo com jitter; com falhas -> backoff.
pub fn next_poll_at(now: DateTime<Utc>, interval_minutes: i64, fail_count: i64, rand01: f64) -> DateTime<Utc> {
    let secs = if fail_count <= 0 {
        jittered_secs(interval_minutes, rand01)
    } else {
        backoff_secs(interval_minutes, fail_count)
    };
    now + Duration::seconds(secs)
}

static SEED: AtomicU64 = AtomicU64::new(0);

/// PRNG simples (xorshift64*) semeado pelo relógio; suficiente para jitter.
pub fn rand01() -> f64 {
    let mut s = SEED.load(Ordering::Relaxed);
    if s == 0 {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        s = nanos | 1;
    }
    s ^= s >> 12;
    s ^= s << 25;
    s ^= s >> 27;
    SEED.store(s, Ordering::Relaxed);
    let out = s.wrapping_mul(0x2545_F491_4F6C_DD1D);
    (out >> 11) as f64 / (1u64 << 53) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn interval_rules() {
        let mut s = ComprasSettings::default();
        assert_eq!(interval_minutes(&s, OfferAdapter::Kabum), 120);
        assert_eq!(interval_minutes(&s, OfferAdapter::Amazon), 360);
        s.poll_interval_minutes = 10;
        assert_eq!(interval_minutes(&s, OfferAdapter::Generic), 60);
        s.poll_interval_minutes = 999;
        assert_eq!(interval_minutes(&s, OfferAdapter::Generic), 180);
        s.amazon_min_interval_minutes = 120;
        assert_eq!(interval_minutes(&s, OfferAdapter::Amazon), 180);
    }

    #[test]
    fn jitter_bounds() {
        let base = 120 * 60;
        let lo = jittered_secs(120, 0.0);
        let hi = jittered_secs(120, 0.999_999);
        assert_eq!(lo, (base as f64 * 0.85).round() as i64);
        assert!(hi <= (base as f64 * 1.15).round() as i64 && hi > base);
        assert_eq!(jittered_secs(120, 0.5), base);
        for i in 0..=1000 {
            let v = jittered_secs(60, i as f64 / 1000.0);
            assert!(v >= 3060 && v <= 4140, "{v}");
        }
    }

    #[test]
    fn backoff_doubles_and_caps_at_24h() {
        assert_eq!(backoff_secs(120, 0), 7200);
        assert_eq!(backoff_secs(120, 1), 14400);
        assert_eq!(backoff_secs(120, 2), 28800);
        assert_eq!(backoff_secs(120, 3), 57600);
        assert_eq!(backoff_secs(120, 4), BACKOFF_CAP_SECS);
        assert_eq!(backoff_secs(120, 50), BACKOFF_CAP_SECS);
        assert_eq!(backoff_secs(360, 10), BACKOFF_CAP_SECS);
    }

    #[test]
    fn next_poll_uses_injected_now() {
        let now = Utc.with_ymd_and_hms(2026, 11, 5, 12, 0, 0).unwrap();
        assert_eq!(next_poll_at(now, 120, 0, 0.5), now + Duration::hours(2));
        assert_eq!(next_poll_at(now, 120, 2, 0.0), now + Duration::seconds(28800));
        assert_eq!(next_poll_at(now, 120, 9, 0.9), now + Duration::hours(24));
    }

    #[test]
    fn rand_is_in_unit_interval() {
        for _ in 0..1000 {
            let r = rand01();
            assert!((0.0..1.0).contains(&r));
        }
    }
}
