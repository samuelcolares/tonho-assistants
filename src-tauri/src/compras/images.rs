//! Imagens de produto em `app_config_dir/compras/images/<itemId>.<ext>` (<= 5 MB, jpeg/png/webp).

use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 5 * 1024 * 1024;
const EXTS: [&str; 3] = ["jpg", "png", "webp"];

/// Detecta o formato pelos bytes (não confia em Content-Type nem em extensão).
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        Some("jpg")
    } else if bytes.len() >= 8 && bytes[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// Ids vêm do frontend: só aceita caracteres de uuid (sem separadores de caminho).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Remove imagens antigas do item (qualquer extensão).
pub fn remove_all(images_dir: &Path, item_id: &str) {
    if !valid_id(item_id) {
        return;
    }
    for ext in EXTS {
        let _ = std::fs::remove_file(images_dir.join(format!("{item_id}.{ext}")));
    }
}

/// Valida e grava (tmp + rename). Retorna (caminho absoluto, caminho relativo a `compras/`).
pub fn save_bytes(compras_dir: &Path, item_id: &str, bytes: &[u8]) -> Result<(PathBuf, String), String> {
    if !valid_id(item_id) {
        return Err("Identificador de item inválido.".to_string());
    }
    if bytes.is_empty() {
        return Err("Imagem vazia.".to_string());
    }
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Imagem maior que 5 MB.".to_string());
    }
    let ext = sniff(bytes).ok_or_else(|| "Formato de imagem não suportado (use JPEG, PNG ou WebP).".to_string())?;
    let dir = compras_dir.join("images");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Não foi possível criar a pasta de imagens: {e}"))?;
    let tmp = dir.join(format!("{item_id}.{ext}.tmp"));
    let dest = dir.join(format!("{item_id}.{ext}"));
    std::fs::write(&tmp, bytes).map_err(|e| format!("Não foi possível gravar a imagem: {e}"))?;
    // remove outras extensões do mesmo item só depois de gravar o tmp com sucesso
    for other in EXTS.iter().filter(|e| **e != ext) {
        let _ = std::fs::remove_file(dir.join(format!("{item_id}.{other}")));
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        // Windows não sobrescreve em alguns casos: tenta remover o destino e repetir
        let _ = std::fs::remove_file(&dest);
        if let Err(e2) = std::fs::rename(&tmp, &dest) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Não foi possível salvar a imagem: {e} / {e2}"));
        }
    }
    Ok((dest, format!("images/{item_id}.{ext}")))
}

/// Copia um arquivo escolhido pelo usuário (valida tamanho antes de ler).
pub fn read_user_file(path: &str) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|_| "Arquivo de imagem não encontrado.".to_string())?;
    if !meta.is_file() {
        return Err("O caminho informado não é um arquivo.".to_string());
    }
    if meta.len() > MAX_BYTES {
        return Err("Imagem maior que 5 MB.".to_string());
    }
    std::fs::read(p).map_err(|e| format!("Não foi possível ler a imagem: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 12] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn sniffing() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0]), Some("jpg"));
        assert_eq!(sniff(&PNG), Some("png"));
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"<html>"), None);
        assert_eq!(sniff(b"GIF89a......"), None);
    }

    #[test]
    fn ids() {
        assert!(valid_id("3f2a-9b1c"));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }

    #[test]
    fn save_replaces_and_stays_inside_images_dir() {
        let dir = tempfile::tempdir().unwrap();
        let (p, rel) = save_bytes(dir.path(), "item-1", &PNG).unwrap();
        assert_eq!(rel, "images/item-1.png");
        assert!(p.exists());
        assert!(!dir.path().join("images/item-1.png.tmp").exists());
        // troca de formato remove o anterior
        let (p2, rel2) = save_bytes(dir.path(), "item-1", &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2]).unwrap();
        assert_eq!(rel2, "images/item-1.jpg");
        assert!(p2.exists());
        assert!(!p.exists());
        // sobrescrever o mesmo formato funciona
        assert!(save_bytes(dir.path(), "item-1", &[0xFF, 0xD8, 0xFF, 0xE0, 9]).is_ok());
        assert!(save_bytes(dir.path(), "../evil", &PNG).is_err());
        assert!(save_bytes(dir.path(), "item-2", b"not an image").is_err());
        assert!(save_bytes(dir.path(), "item-2", &vec![0xFF; 6 * 1024 * 1024]).is_err());
        remove_all(&dir.path().join("images"), "item-1");
        assert!(!p2.exists());
    }
}
