//! Templates de especificação por categoria (seed) e atribuição por prefixo do nome.

use super::model::{CategoryTemplate, SpecField};
use std::collections::BTreeMap;

fn f(key: &str, label: &str, kind: &str, options: Option<&[&str]>, unit: Option<&str>) -> SpecField {
    SpecField {
        key: key.to_string(),
        label: label.to_string(),
        kind: kind.to_string(),
        options: options.map(|o| o.iter().map(|s| s.to_string()).collect()),
        unit: unit.map(|s| s.to_string()),
    }
}

const VOLT: &[&str] = &["110V", "220V", "Bivolt"];

pub fn seed_templates() -> Vec<CategoryTemplate> {
    vec![
        CategoryTemplate {
            id: "ar-condicionado".into(),
            name: "Ar-condicionado".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("btus", "Capacidade", "number", None, Some("BTU")),
                f("inverter", "Inverter", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
                f("ciclo", "Ciclo", "enum", Some(&["Frio", "Quente/Frio"]), None),
            ],
        },
        CategoryTemplate {
            id: "geladeira".into(),
            name: "Geladeira".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("frost_free", "Frost free", "bool", None, None),
                f("tipo", "Tipo", "enum", Some(&["Duplex", "Side by side", "French door", "Inverse"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        },
        CategoryTemplate {
            id: "cooktop".into(),
            name: "Cooktop".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("bocas", "Bocas/zonas", "number", None, None),
                f("tipo", "Tipo", "enum", Some(&["Indução", "Gás", "Elétrico"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        },
        CategoryTemplate {
            id: "forno".into(),
            name: "Forno".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("tipo", "Tipo", "enum", Some(&["Elétrico", "Gás"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        },
        CategoryTemplate {
            id: "robo-aspirador".into(),
            name: "Robô aspirador".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("mapeamento", "Mapeamento", "bool", None, None),
                f("passa_pano", "Passa pano", "bool", None, None),
                f("auto_esvazia", "Base que esvazia", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        },
        CategoryTemplate {
            id: "lava-loucas".into(),
            name: "Lava-louças".into(),
            fields: vec![
                f("marca", "Marca", "text", None, None),
                f("servicos", "Serviços", "number", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
                f("garantia", "Garantia estendida", "bool", None, None),
            ],
        },
    ]
}

/// Minúsculas, sem acento, sem pontuação (para comparar prefixos e cabeçalhos).
pub fn fold(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            let c = c.to_lowercase().next().unwrap_or(c);
            let m = match c {
                'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
                'é' | 'è' | 'ê' | 'ë' => 'e',
                'í' | 'ì' | 'î' | 'ï' => 'i',
                'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
                'ú' | 'ù' | 'û' | 'ü' => 'u',
                'ç' => 'c',
                other => other,
            };
            if m.is_ascii_alphanumeric() {
                Some(m)
            } else {
                None
            }
        })
        .collect()
}

/// Template pelo prefixo do nome do item ("Ar-condicionado - 9000 btus" -> ar-condicionado).
pub fn template_for_name(name: &str) -> Option<&'static str> {
    let n = fold(name);
    const TABLE: &[(&str, &str)] = &[
        ("arcondicionado", "ar-condicionado"),
        ("geladeira", "geladeira"),
        ("cooktop", "cooktop"),
        ("forno", "forno"),
        ("roboaspirador", "robo-aspirador"),
        ("lavaloucas", "lava-loucas"),
    ];
    TABLE.iter().find(|(prefix, _)| n.starts_with(prefix)).map(|(_, id)| *id)
}

/// `(\d+)\s*btus?` sem regex.
pub fn parse_btus(name: &str) -> Option<i64> {
    let lower = name.to_lowercase();
    let idx = lower.find("btu")?;
    let before = lower[..idx].trim_end();
    let digits_rev: String = before.chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let digits: String = digits_rev.chars().rev().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// Specs iniciais deduzidas do nome.
pub fn initial_specs(template_id: Option<&str>, name: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    if template_id == Some("ar-condicionado") {
        if let Some(b) = parse_btus(name) {
            m.insert("btus".to_string(), b.to_string());
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_cover_spec_categories() {
        let ids: Vec<String> = seed_templates().into_iter().map(|t| t.id).collect();
        for want in ["ar-condicionado", "geladeira", "cooktop", "forno", "robo-aspirador", "lava-loucas"] {
            assert!(ids.iter().any(|i| i == want), "falta {want}");
        }
        let ac = seed_templates().into_iter().find(|t| t.id == "ar-condicionado").unwrap();
        let keys: Vec<_> = ac.fields.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"btus") && keys.contains(&"inverter") && keys.contains(&"voltagem") && keys.contains(&"marca"));
    }

    #[test]
    fn name_prefix_assignment() {
        assert_eq!(template_for_name("Ar-condicionado - 24000 btus"), Some("ar-condicionado"));
        assert_eq!(template_for_name("Geladeira"), Some("geladeira"));
        assert_eq!(template_for_name("Cooktop de indução"), Some("cooktop"));
        assert_eq!(template_for_name("Forno de embutir"), Some("forno"));
        assert_eq!(template_for_name("Robô aspirador"), Some("robo-aspirador"));
        assert_eq!(template_for_name("Lava-louças com garantia"), Some("lava-loucas"));
        assert_eq!(template_for_name("Coifa"), None);
    }

    #[test]
    fn btus_parsing() {
        assert_eq!(parse_btus("Ar-condicionado - 24000 btus"), Some(24000));
        assert_eq!(parse_btus("Ar-condicionado - 9000 btus"), Some(9000));
        assert_eq!(parse_btus("Ar 12.000 BTUs"), Some(12000));
        assert_eq!(parse_btus("Ar 18000btu"), Some(18000));
        assert_eq!(parse_btus("Geladeira"), None);
    }
}
