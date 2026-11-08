//! Templates de especificação por categoria (seed) e atribuição pelo nome do item.

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
const SOQUETES: &[&str] = &["AM4", "AM5", "LGA1151", "LGA1200", "LGA1700", "LGA1851"];
const FORMATOS: &[&str] = &["ATX", "mATX", "ITX", "E-ATX"];
const RAM_TIPOS: &[&str] = &["DDR4", "DDR5"];

fn tpl(id: &str, name: &str, fields: Vec<SpecField>) -> CategoryTemplate {
    CategoryTemplate { id: id.to_string(), name: name.to_string(), fields }
}

/// Modelos de série. A semeadura é `INSERT OR IGNORE` por id: modelos novos entram em bancos antigos e
/// os que o usuário editou não são tocados.
pub fn seed_templates() -> Vec<CategoryTemplate> {
    vec![
        tpl(
            "ar-condicionado",
            "Ar-condicionado",
            vec![
                f("marca", "Marca", "text", None, None),
                f("btus", "Capacidade", "number", None, Some("BTU")),
                f("inverter", "Inverter", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
                f("ciclo", "Ciclo", "enum", Some(&["Frio", "Quente/Frio"]), None),
            ],
        ),
        tpl(
            "geladeira",
            "Geladeira",
            vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("frost_free", "Frost free", "bool", None, None),
                f("tipo", "Tipo", "enum", Some(&["Duplex", "Side by side", "French door", "Inverse"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "cooktop",
            "Cooktop",
            vec![
                f("marca", "Marca", "text", None, None),
                f("bocas", "Bocas/zonas", "number", None, None),
                f("tipo", "Tipo", "enum", Some(&["Indução", "Gás", "Elétrico"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "forno",
            "Forno",
            vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("tipo", "Tipo", "enum", Some(&["Elétrico", "Gás"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "robo-aspirador",
            "Robô aspirador",
            vec![
                f("marca", "Marca", "text", None, None),
                f("mapeamento", "Mapeamento", "bool", None, None),
                f("passa_pano", "Passa pano", "bool", None, None),
                f("auto_esvazia", "Base que esvazia", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "lava-loucas",
            "Lava-louças",
            vec![
                f("marca", "Marca", "text", None, None),
                f("servicos", "Serviços", "number", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
                f("garantia", "Garantia estendida", "bool", None, None),
            ],
        ),
        // ---- peças de PC
        tpl(
            "placa-de-video",
            "Placa de vídeo",
            vec![
                f("marca", "Marca", "text", None, None),
                f("chipset", "Chipset / modelo da GPU", "text", None, None),
                f("vram", "Memória de vídeo (VRAM)", "number", None, Some("GB")),
                f("tamanho", "Comprimento", "number", None, Some("mm")),
                f("consumo", "Consumo", "number", None, Some("W")),
                f("conectores", "Conectores de energia", "text", None, None),
            ],
        ),
        tpl(
            "processador",
            "Processador",
            vec![
                f("marca", "Marca", "enum", Some(&["AMD", "Intel"]), None),
                f("modelo", "Modelo", "text", None, None),
                f("soquete", "Soquete", "enum", Some(SOQUETES), None),
                f("nucleos", "Núcleos", "number", None, None),
                f("threads", "Threads", "number", None, None),
                f("tdp", "TDP", "number", None, Some("W")),
                f("cooler_incluso", "Cooler incluso", "bool", None, None),
            ],
        ),
        tpl(
            "memoria-ram",
            "Memória RAM",
            vec![
                f("tipo", "Tipo", "enum", Some(RAM_TIPOS), None),
                f("capacidade", "Capacidade total", "number", None, Some("GB")),
                f("kit", "Kit", "enum", Some(&["1x", "2x", "4x"]), None),
                f("frequencia", "Frequência", "number", None, Some("MHz")),
                f("latencia", "Latência", "number", None, Some("CL")),
            ],
        ),
        tpl(
            "ssd",
            "SSD",
            vec![
                f("interface", "Interface", "enum", Some(&["NVMe", "SATA"]), None),
                f("capacidade", "Capacidade", "number", None, Some("GB")),
                f("leitura", "Velocidade de leitura", "number", None, Some("MB/s")),
                f("dram", "Tem cache DRAM", "bool", None, None),
            ],
        ),
        tpl(
            "placa-mae",
            "Placa-mãe",
            vec![
                f("soquete", "Soquete", "enum", Some(SOQUETES), None),
                f("chipset", "Chipset", "text", None, None),
                f("formato", "Formato", "enum", Some(FORMATOS), None),
                f("tipo_ram", "Tipo de RAM", "enum", Some(RAM_TIPOS), None),
                f("wifi", "Wi-Fi", "bool", None, None),
            ],
        ),
        tpl(
            "fonte",
            "Fonte",
            vec![
                f("potencia", "Potência", "number", None, Some("W")),
                f(
                    "certificacao",
                    "Certificação 80 Plus",
                    "enum",
                    Some(&["Sem certificação", "White", "Bronze", "Silver", "Gold", "Platinum", "Titanium"]),
                    None,
                ),
                f("modular", "Modular", "enum", Some(&["Não", "Semi", "Full"]), None),
            ],
        ),
        tpl(
            "gabinete",
            "Gabinete",
            vec![
                f("formato", "Formato suportado", "enum", Some(FORMATOS), None),
                f("cor", "Cor", "text", None, None),
                f("vidro", "Vidro lateral", "bool", None, None),
            ],
        ),
        tpl(
            "monitor",
            "Monitor",
            vec![
                f("polegadas", "Tamanho", "number", None, Some("pol")),
                f("resolucao", "Resolução", "enum", Some(&["1920x1080", "2560x1440", "3440x1440", "3840x2160"]), None),
                f("taxa", "Taxa de atualização", "number", None, Some("Hz")),
                f("painel", "Painel", "enum", Some(&["IPS", "VA", "TN", "OLED"]), None),
            ],
        ),
        tpl(
            "cooler",
            "Cooler",
            vec![
                f("tipo", "Tipo", "enum", Some(&["Ar", "Water cooler"]), None),
                f("tamanho", "Tamanho", "number", None, Some("mm")),
                f("soquetes", "Soquetes compatíveis", "text", None, None),
            ],
        ),
        // ---- casa
        tpl(
            "ventilador",
            "Ventilador",
            vec![
                f("marca", "Marca", "text", None, None),
                f("tipo", "Tipo", "enum", Some(&["Mesa", "Coluna", "Torre", "Parede", "Teto"]), None),
                f("diametro", "Diâmetro", "number", None, Some("cm")),
                f("velocidades", "Velocidades", "number", None, None),
                f("controle", "Controle remoto", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "micro-ondas",
            "Micro-ondas",
            vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("potencia", "Potência", "number", None, Some("W")),
                f("grill", "Função grill", "bool", None, None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "air-fryer",
            "Air fryer",
            vec![
                f("marca", "Marca", "text", None, None),
                f("litros", "Capacidade", "number", None, Some("L")),
                f("potencia", "Potência", "number", None, Some("W")),
                f("tipo", "Tipo", "enum", Some(&["Cesto", "Forno", "Dupla"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "smart-tv",
            "Smart TV",
            vec![
                f("marca", "Marca", "text", None, None),
                f("polegadas", "Tamanho", "number", None, Some("pol")),
                f("resolucao", "Resolução", "enum", Some(&["HD", "Full HD", "4K", "8K"]), None),
                f("painel", "Painel", "enum", Some(&["LED", "QLED", "OLED", "Mini LED"]), None),
                f("sistema", "Sistema", "enum", Some(&["Google TV", "Android TV", "Tizen", "webOS", "Roku", "Outro"]), None),
            ],
        ),
        tpl(
            "maquina-de-lavar",
            "Máquina de lavar",
            vec![
                f("marca", "Marca", "text", None, None),
                f("kg", "Capacidade", "number", None, Some("kg")),
                f("tipo", "Tipo", "enum", Some(&["Automática", "Lava e seca", "Semiautomática", "Tanquinho"]), None),
                f("abertura", "Abertura", "enum", Some(&["Superior", "Frontal"]), None),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
        tpl(
            "aspirador-vertical",
            "Aspirador vertical",
            vec![
                f("marca", "Marca", "text", None, None),
                f("potencia", "Potência", "number", None, Some("W")),
                f("sem_fio", "Sem fio", "bool", None, None),
                f("autonomia", "Autonomia da bateria", "number", None, Some("min")),
                f("voltagem", "Voltagem", "enum", Some(VOLT), None),
            ],
        ),
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

/// Minúsculas, sem acento, com tudo que não é letra/dígito virando um espaço, e um espaço em cada ponta:
/// "Placa-mãe B550 (M.2)" -> " placa mae b550 m 2 ". Permite casar palavra inteira ou começo de palavra.
pub fn fold_words(s: &str) -> String {
    let mut out = String::from(" ");
    let mut last_space = true;
    for c in s.chars() {
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
            out.push(m);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    if !last_space {
        out.push(' ');
    }
    out
}

/// Palavras-chave -> template, sobre o texto de `fold_words`. Agulha com espaço no fim = palavra inteira;
/// sem espaço no fim = começo de palavra (" rtx" casa "rtx4060"). Vale a ocorrência que aparece primeiro
/// no nome (o substantivo vem antes: "Gabinete Cooler Master" é gabinete); empate: agulha mais longa.
/// Espelhada em `src/features/compras/templates.ts` (KEYWORDS): mantenha as duas iguais.
const KEYWORDS: &[(&str, &str)] = &[
    // peças de PC
    (" placa de video", "placa-de-video"),
    (" placa video", "placa-de-video"),
    (" rtx", "placa-de-video"),
    (" gtx", "placa-de-video"),
    (" geforce", "placa-de-video"),
    (" radeon", "placa-de-video"),
    (" intel arc ", "placa-de-video"),
    (" gpu ", "placa-de-video"),
    (" rx 5", "placa-de-video"),
    (" rx 6", "placa-de-video"),
    (" rx 7", "placa-de-video"),
    (" rx 9", "placa-de-video"),
    (" rx5", "placa-de-video"),
    (" rx6", "placa-de-video"),
    (" rx7", "placa-de-video"),
    (" rx9", "placa-de-video"),
    (" processador", "processador"),
    (" ryzen", "processador"),
    (" core i3", "processador"),
    (" core i5", "processador"),
    (" core i7", "processador"),
    (" core i9", "processador"),
    (" core ultra", "processador"),
    (" i3 ", "processador"),
    (" i5 ", "processador"),
    (" i7 ", "processador"),
    (" i9 ", "processador"),
    (" xeon", "processador"),
    (" athlon", "processador"),
    (" pentium", "processador"),
    (" celeron", "processador"),
    (" threadripper", "processador"),
    (" cpu ", "processador"),
    (" memoria ram", "memoria-ram"),
    (" memoria ddr", "memoria-ram"),
    (" ddr3", "memoria-ram"),
    (" ddr4", "memoria-ram"),
    (" ddr5", "memoria-ram"),
    (" dimm", "memoria-ram"),
    (" sodimm", "memoria-ram"),
    (" ram ", "memoria-ram"),
    (" ssd", "ssd"),
    (" nvme", "ssd"),
    (" m 2 ", "ssd"),
    (" placa mae", "placa-mae"),
    (" motherboard", "placa-mae"),
    (" mobo ", "placa-mae"),
    (" a520", "placa-mae"),
    (" a620", "placa-mae"),
    (" b450", "placa-mae"),
    (" b550", "placa-mae"),
    (" b650", "placa-mae"),
    (" b850", "placa-mae"),
    (" x570", "placa-mae"),
    (" x670", "placa-mae"),
    (" x870", "placa-mae"),
    (" h410", "placa-mae"),
    (" h510", "placa-mae"),
    (" h610", "placa-mae"),
    (" b560", "placa-mae"),
    (" b660", "placa-mae"),
    (" b760", "placa-mae"),
    (" z490", "placa-mae"),
    (" z590", "placa-mae"),
    (" z690", "placa-mae"),
    (" z790", "placa-mae"),
    (" z890", "placa-mae"),
    (" fonte", "fonte"),
    (" psu ", "fonte"),
    (" 80 plus", "fonte"),
    (" gabinete", "gabinete"),
    (" mid tower", "gabinete"),
    (" full tower", "gabinete"),
    (" monitor", "monitor"),
    (" cooler", "cooler"),
    (" watercooler", "cooler"),
    (" dissipador", "cooler"),
    (" heatsink", "cooler"),
    // casa
    (" ventilador", "ventilador"),
    (" circulador", "ventilador"),
    (" micro ondas", "micro-ondas"),
    (" microondas", "micro-ondas"),
    (" air fryer", "air-fryer"),
    (" airfryer", "air-fryer"),
    (" fritadeira", "air-fryer"),
    (" smart tv", "smart-tv"),
    (" televisao", "smart-tv"),
    (" televisor", "smart-tv"),
    (" tv ", "smart-tv"),
    (" maquina de lavar", "maquina-de-lavar"),
    (" lavadora", "maquina-de-lavar"),
    (" lava e seca", "maquina-de-lavar"),
    (" aspirador vertical", "aspirador-vertical"),
    (" aspirador de po", "aspirador-vertical"),
    (" aspirador ", "aspirador-vertical"),
    // modelos que já existiam
    (" robo aspirador", "robo-aspirador"),
    (" aspirador robo", "robo-aspirador"),
    (" ar condicionado", "ar-condicionado"),
    (" geladeira", "geladeira"),
    (" refrigerador", "geladeira"),
    (" cooktop", "cooktop"),
    (" forno ", "forno"),
    (" lava loucas", "lava-loucas"),
];

/// Template pelo nome do item: primeiro o prefixo ("Ar-condicionado - 9000 btus" -> ar-condicionado),
/// depois palavras-chave em qualquer posição ("Placa de vídeo RTX 4060", "Ryzen 5 5600" -> processador).
pub fn template_for_name(name: &str) -> Option<&'static str> {
    const TABLE: &[(&str, &str)] = &[
        ("arcondicionado", "ar-condicionado"),
        ("geladeira", "geladeira"),
        ("cooktop", "cooktop"),
        ("forno", "forno"),
        ("roboaspirador", "robo-aspirador"),
        ("lavaloucas", "lava-loucas"),
    ];
    let n = fold(name);
    if let Some((_, id)) = TABLE.iter().find(|(prefix, _)| n.starts_with(prefix)) {
        return Some(*id);
    }
    let words = fold_words(name);
    let mut best: Option<(usize, usize, &'static str)> = None; // (posição, tamanho da agulha, id)
    for (needle, id) in KEYWORDS {
        if let Some(pos) = words.find(needle) {
            let better = match best {
                None => true,
                Some((bp, bl, _)) => pos < bp || (pos == bp && needle.len() > bl),
            };
            if better {
                best = Some((pos, needle.len(), id));
            }
        }
    }
    best.map(|(_, _, id)| id)
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
    let words = fold_words(name);
    match template_id {
        Some("ar-condicionado") => {
            if let Some(b) = parse_btus(name) {
                m.insert("btus".to_string(), b.to_string());
            }
        }
        Some(id @ ("memoria-ram" | "placa-mae")) => {
            let key = if id == "placa-mae" { "tipo_ram" } else { "tipo" };
            for t in ["ddr5", "ddr4"] {
                if words.contains(&format!(" {t}")) {
                    m.insert(key.to_string(), t.to_uppercase());
                    break;
                }
            }
        }
        Some("ssd") => {
            if words.contains(" nvme") || words.contains(" m 2 ") {
                m.insert("interface".to_string(), "NVMe".to_string());
            } else if words.contains(" sata") {
                m.insert("interface".to_string(), "SATA".to_string());
            }
        }
        _ => {}
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_cover_spec_categories() {
        let ids: Vec<String> = seed_templates().into_iter().map(|t| t.id).collect();
        for want in [
            "ar-condicionado",
            "geladeira",
            "cooktop",
            "forno",
            "robo-aspirador",
            "lava-loucas",
            "placa-de-video",
            "processador",
            "memoria-ram",
            "ssd",
            "placa-mae",
            "fonte",
            "gabinete",
            "monitor",
            "cooler",
            "ventilador",
            "micro-ondas",
            "air-fryer",
            "smart-tv",
            "maquina-de-lavar",
            "aspirador-vertical",
        ] {
            assert!(ids.iter().any(|i| i == want), "falta {want}");
        }
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len(), "ids de template repetidos");
        let ac = seed_templates().into_iter().find(|t| t.id == "ar-condicionado").unwrap();
        let keys: Vec<_> = ac.fields.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"btus") && keys.contains(&"inverter") && keys.contains(&"voltagem") && keys.contains(&"marca"));
    }

    #[test]
    fn pc_templates_have_the_audited_fields() {
        let all = seed_templates();
        let keys = |id: &str| -> Vec<String> { all.iter().find(|t| t.id == id).unwrap().fields.iter().map(|f| f.key.clone()).collect() };
        for k in ["marca", "chipset", "vram", "tamanho", "consumo", "conectores"] {
            assert!(keys("placa-de-video").iter().any(|x| x == k), "gpu sem {k}");
        }
        for k in ["marca", "modelo", "soquete", "nucleos", "threads", "tdp", "cooler_incluso"] {
            assert!(keys("processador").iter().any(|x| x == k), "cpu sem {k}");
        }
        for k in ["tipo", "capacidade", "kit", "frequencia", "latencia"] {
            assert!(keys("memoria-ram").iter().any(|x| x == k), "ram sem {k}");
        }
        for k in ["interface", "capacidade", "leitura", "dram"] {
            assert!(keys("ssd").iter().any(|x| x == k), "ssd sem {k}");
        }
        for k in ["soquete", "chipset", "formato", "tipo_ram", "wifi"] {
            assert!(keys("placa-mae").iter().any(|x| x == k), "placa-mae sem {k}");
        }
        // todo campo enum tem opções; chaves únicas por modelo
        for t in &all {
            let mut ks: Vec<_> = t.fields.iter().map(|f| f.key.clone()).collect();
            ks.sort();
            let n = ks.len();
            ks.dedup();
            assert_eq!(ks.len(), n, "chave repetida em {}", t.id);
            for fld in &t.fields {
                if fld.kind == "enum" {
                    assert!(fld.options.as_ref().map(|o| !o.is_empty()).unwrap_or(false), "{}.{} sem opções", t.id, fld.key);
                }
            }
        }
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
    fn keyword_suggestion_for_pc_parts() {
        assert_eq!(template_for_name("Placa de vídeo RTX 4060 8GB"), Some("placa-de-video"));
        assert_eq!(template_for_name("RTX 4070 Super Gigabyte"), Some("placa-de-video"));
        assert_eq!(template_for_name("GTX 1650"), Some("placa-de-video"));
        assert_eq!(template_for_name("Radeon RX 7600"), Some("placa-de-video"));
        assert_eq!(template_for_name("AMD RX 6600 8GB"), Some("placa-de-video"));
        assert_eq!(template_for_name("Ryzen 5 5600"), Some("processador"));
        assert_eq!(template_for_name("Intel Core i5-12400F"), Some("processador"));
        assert_eq!(template_for_name("Processador Intel i7 14700K"), Some("processador"));
        assert_eq!(template_for_name("Kingston Fury 16GB DDR4 3200"), Some("memoria-ram"));
        assert_eq!(template_for_name("Memória RAM 32GB DDR5"), Some("memoria-ram"));
        assert_eq!(template_for_name("SSD NVMe 1TB"), Some("ssd"));
        assert_eq!(template_for_name("WD Black SN770 M.2 1TB"), Some("ssd"));
        assert_eq!(template_for_name("Placa-mãe B550M DDR4"), Some("placa-mae"));
        assert_eq!(template_for_name("ASUS TUF B650-Plus"), Some("placa-mae"));
        assert_eq!(template_for_name("Fonte 650W 80 Plus Bronze"), Some("fonte"));
        assert_eq!(template_for_name("Gabinete Gamer vidro temperado"), Some("gabinete"));
        assert_eq!(template_for_name("Monitor 27 144Hz IPS"), Some("monitor"));
        assert_eq!(template_for_name("Water Cooler 240mm"), Some("cooler"));
        assert_eq!(template_for_name("Cooler para processador"), Some("cooler"));
    }

    #[test]
    fn keyword_suggestion_for_home_items() {
        assert_eq!(template_for_name("Ventilador de coluna 40cm"), Some("ventilador"));
        assert_eq!(template_for_name("Microondas 30L"), Some("micro-ondas"));
        assert_eq!(template_for_name("Micro-ondas Electrolux"), Some("micro-ondas"));
        assert_eq!(template_for_name("Air Fryer 5L"), Some("air-fryer"));
        assert_eq!(template_for_name("Smart TV 55 4K"), Some("smart-tv"));
        assert_eq!(template_for_name("TV 50 polegadas"), Some("smart-tv"));
        assert_eq!(template_for_name("Máquina de lavar 12kg"), Some("maquina-de-lavar"));
        assert_eq!(template_for_name("Aspirador vertical sem fio"), Some("aspirador-vertical"));
        assert_eq!(template_for_name("Aspirador de pó"), Some("aspirador-vertical"));
        assert_eq!(template_for_name("Aspirador robô Xiaomi"), Some("robo-aspirador"));
    }

    #[test]
    fn keyword_precedence_and_false_positives() {
        // o substantivo que vem primeiro manda
        assert_eq!(template_for_name("Gabinete Cooler Master NR200"), Some("gabinete"));
        assert_eq!(template_for_name("Fonte Cooler Master MWE 650W"), Some("fonte"));
        assert_eq!(template_for_name("Placa-mãe com Wi-Fi para Ryzen"), Some("placa-mae"));
        // palavras que só contêm a sigla não casam
        assert_eq!(template_for_name("Sofá retrátil"), None);
        assert_eq!(template_for_name("Estante para livros"), None);
        assert_eq!(template_for_name("Mesa de jantar"), None);
        assert_eq!(template_for_name("Tapete"), None);
        assert_eq!(template_for_name(""), None);
    }

    #[test]
    fn initial_specs_from_pc_names() {
        let ram = initial_specs(Some("memoria-ram"), "Memória 16GB DDR5 6000");
        assert_eq!(ram.get("tipo").map(String::as_str), Some("DDR5"));
        let mb = initial_specs(Some("placa-mae"), "Placa-mãe B550M DDR4");
        assert_eq!(mb.get("tipo_ram").map(String::as_str), Some("DDR4"));
        let ssd = initial_specs(Some("ssd"), "SSD NVMe 1TB");
        assert_eq!(ssd.get("interface").map(String::as_str), Some("NVMe"));
        let sata = initial_specs(Some("ssd"), "SSD SATA 480GB");
        assert_eq!(sata.get("interface").map(String::as_str), Some("SATA"));
        assert!(initial_specs(Some("fonte"), "Fonte 650W").is_empty());
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
