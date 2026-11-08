//! Dinheiro em centavos inteiros (i64). Nunca float para valor armazenado.

use serde_json::Value;

/// Converte reais (float vindo de JSON) em centavos, arredondando.
pub fn cents_from_f64(v: f64) -> Option<i64> {
    if !v.is_finite() || v <= 0.0 || v > 1.0e9 {
        return None;
    }
    Some((v * 100.0).round() as i64)
}

/// Preço vindo de JSON/JSON-LD: número, ou string. Em string sem vírgula o
/// ponto é decimal (padrão schema.org: "1352.93"); com vírgula vale BRL.
pub fn cents_from_json(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_f64().and_then(cents_from_f64),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return None;
            }
            if !t.contains(',') {
                if let Ok(f) = t.parse::<f64>() {
                    return cents_from_f64(f);
                }
            }
            parse_brl(t)
        }
        _ => None,
    }
}

/// Retorna true se, a partir do fim do token numérico, o texto indica
/// parcelamento ("12x", "12 x de", "10×").
fn followed_by_installment_marker(rest: &str) -> bool {
    let r = rest.trim_start();
    let mut chars = r.chars();
    match chars.next() {
        Some('x') | Some('X') | Some('×') => {
            // "12x de R$ ..." / "12x R$..." / "12x 99" / "12x sem juros"
            match chars.next() {
                None => true,
                Some(c) => c.is_whitespace() || c.is_ascii_digit() || c == 'd' || c == 'D' || c == 'R' || c == 'r' || c == 's' || c == 'S',
            }
        }
        _ => false,
    }
}

/// Interpreta o primeiro valor numérico de um texto BRL ("R$ 1.299,90",
/// "R$343,14", "1299.90", "99,9"). Textos de parcelamento ("12x de R$ 99,90")
/// nunca viram preço: retorna None. Valor zero/negativo retorna None.
pub fn parse_brl(text: &str) -> Option<i64> {
    let chars: Vec<char> = text.chars().collect();
    // acha o início do primeiro token numérico
    let mut i = 0;
    while i < chars.len() && !chars[i].is_ascii_digit() {
        i += 1;
    }
    if i >= chars.len() {
        return None;
    }
    let prefix: String = chars[..i].iter().collect();
    if prefix.trim_start().starts_with('-') || prefix.trim_end().ends_with('-') {
        return None;
    }
    let start = i;
    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == ',') {
        i += 1;
    }
    let mut token: String = chars[start..i].iter().collect();
    // separador pendurado no fim ("R$ 99," ou "99.")
    while token.ends_with('.') || token.ends_with(',') {
        token.pop();
    }
    if token.is_empty() {
        return None;
    }
    let rest: String = chars[i..].iter().collect();
    if followed_by_installment_marker(&rest) {
        return None;
    }
    // "R$ 1 299,90" (espaço como milhar) não é suportado de propósito.
    parse_number_token(&token)
}

fn parse_number_token(token: &str) -> Option<i64> {
    let has_dot = token.contains('.');
    let has_comma = token.contains(',');
    let (int_part, frac_part): (String, String) = if has_dot && has_comma {
        let last_dot = token.rfind('.')?;
        let last_comma = token.rfind(',')?;
        let dec_idx = last_dot.max(last_comma);
        let (a, b) = token.split_at(dec_idx);
        (a.chars().filter(|c| c.is_ascii_digit()).collect(), b[1..].to_string())
    } else if has_comma {
        if token.matches(',').count() > 1 {
            return None;
        }
        let (a, b) = token.split_once(',')?;
        (a.to_string(), b.to_string())
    } else if has_dot {
        let dots = token.matches('.').count();
        let last = token.rfind('.')?;
        let after = &token[last + 1..];
        if dots > 1 {
            // todos pontos são milhar: grupos de 3
            let groups: Vec<&str> = token.split('.').collect();
            if groups.iter().skip(1).any(|g| g.len() != 3) {
                return None;
            }
            (token.replace('.', ""), String::new())
        } else if after.len() == 3 {
            (token.replace('.', ""), String::new())
        } else if after.len() <= 2 {
            let (a, b) = token.split_once('.')?;
            (a.to_string(), b.to_string())
        } else {
            return None;
        }
    } else {
        (token.to_string(), String::new())
    };
    if frac_part.len() > 2 {
        return None;
    }
    if int_part.is_empty() && frac_part.is_empty() {
        return None;
    }
    if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let reais: i64 = if int_part.is_empty() { 0 } else { int_part.parse().ok()? };
    let frac: i64 = match frac_part.len() {
        0 => 0,
        1 => frac_part.parse::<i64>().ok()? * 10,
        _ => frac_part.parse::<i64>().ok()?,
    };
    let cents = reais.checked_mul(100)?.checked_add(frac)?;
    if cents <= 0 {
        None
    } else {
        Some(cents)
    }
}

/// "12x de R$ 99,90"
pub fn format_installments(count: i64, each_cents: i64) -> String {
    format!("{count}x de R$ {}", format_brl(each_cents))
}

/// 123456 -> "1.234,56"
pub fn format_brl(cents: i64) -> String {
    let neg = cents < 0;
    let abs = cents.unsigned_abs();
    let reais = abs / 100;
    let frac = abs % 100;
    let s = reais.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    format!("{}{},{:02}", if neg { "-" } else { "" }, out, frac)
}

/// 123456 -> "1234,56" (para CSV pt-BR, sem milhar).
pub fn format_decimal_comma(cents: i64) -> String {
    let neg = cents < 0;
    let abs = cents.unsigned_abs();
    format!("{}{},{:02}", if neg { "-" } else { "" }, abs / 100, abs % 100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_brl_basic_formats() {
        assert_eq!(parse_brl("R$ 1.299,90"), Some(129990));
        assert_eq!(parse_brl("R$343,14"), Some(34314));
        assert_eq!(parse_brl("1299.90"), Some(129990));
        assert_eq!(parse_brl("99,9"), Some(9990));
        assert_eq!(parse_brl("R$ 99"), Some(9900));
        assert_eq!(parse_brl("1.299"), Some(129900));
        assert_eq!(parse_brl("R$ 12.345.678,01"), Some(1234567801));
        assert_eq!(parse_brl("  R$\u{a0}2.599,98  "), Some(259998));
        assert_eq!(parse_brl("R$\u{fffd}343,14"), Some(34314));
        assert_eq!(parse_brl("1149.99"), Some(114999));
    }

    #[test]
    fn parse_brl_rejects_installments_and_garbage() {
        assert_eq!(parse_brl("12x de R$ 99,90"), None);
        assert_eq!(parse_brl("12 x de R$ 99,90"), None);
        assert_eq!(parse_brl("10x R$ 135,29 sem juros"), None);
        assert_eq!(parse_brl("ou 6X de R$ 50,00"), None);
        assert_eq!(parse_brl("grátis"), None);
        assert_eq!(parse_brl(""), None);
        assert_eq!(parse_brl("R$ 0,00"), None);
        assert_eq!(parse_brl("-R$ 10,00"), None);
        assert_eq!(parse_brl("1,2,3"), None);
    }

    #[test]
    fn parse_brl_takes_price_before_installments() {
        assert_eq!(parse_brl("R$ 1.299,90 em 12x de R$ 108,32"), Some(129990));
        assert_eq!(parse_brl("à vista R$ 1.100,00 ou 10x de R$ 120,00"), Some(110000));
    }

    #[test]
    fn json_prices() {
        assert_eq!(cents_from_json(&json!(1149.99)), Some(114999));
        assert_eq!(cents_from_json(&json!(12999)), Some(1299900));
        assert_eq!(cents_from_json(&json!("1352.93")), Some(135293));
        assert_eq!(cents_from_json(&json!("1.352,93")), Some(135293));
        assert_eq!(cents_from_json(&json!(null)), None);
        assert_eq!(cents_from_json(&json!(0)), None);
    }

    #[test]
    fn formatting() {
        assert_eq!(format_brl(123456), "1.234,56");
        assert_eq!(format_brl(5), "0,05");
        assert_eq!(format_brl(100000000), "1.000.000,00");
        assert_eq!(format_decimal_comma(123456), "1234,56");
        assert_eq!(format_installments(12, 9990), "12x de R$ 99,90");
    }
}
