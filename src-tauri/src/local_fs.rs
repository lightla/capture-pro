use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn mime_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    }
}

#[tauri::command]
pub async fn list_local_image_files(dir: String) -> Result<Vec<String>, String> {
    let dir_path = PathBuf::from(dir);
    let mut entries: Vec<(SystemTime, String)> = Vec::new();

    let read_dir = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext = ext.to_lowercase();
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if !name.is_empty() {
            entries.push((modified, name));
        }
    }

    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, n)| n).collect())
}

#[tauri::command]
pub async fn read_local_image_as_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime_for_path(&path), b64))
}

#[tauri::command]
pub async fn delete_local_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
}

fn write_local_file_sync(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn queue_local_base64_write(path: String, data_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let encoded = data_url
                .split_once(',')
                .map(|(_, data)| data)
                .unwrap_or(data_url.as_str());
            let content = general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| format!("Failed to decode base64 image: {}", e))?;
            write_local_file_sync(Path::new(&path), &content)
        })
        .await;
    });
    Ok(())
}

#[tauri::command]
pub async fn list_local_directories(path: String) -> Result<Vec<String>, String> {
    let dir_path = PathBuf::from(path);
    let read_dir = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut dirs: Vec<String> = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
            if !name.is_empty() {
                dirs.push(name.to_string());
            }
        }
    }
    dirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(dirs)
}

#[tauri::command]
pub async fn get_local_home_directory() -> Result<String, String> {
    if let Ok(v) = std::env::var("USERPROFILE") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    if let Ok(v) = std::env::var("HOME") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    if let (Ok(drive), Ok(path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
        let v = format!("{}{}", drive, path);
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    Ok("C:\\".to_string())
}
