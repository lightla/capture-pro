use std::process::Command;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use base64::{Engine as _, engine::general_purpose};

#[derive(Serialize, Deserialize, Debug)]
pub struct WslDistro {
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub async fn list_wsl_distros() -> Result<Vec<WslDistro>, String> {
    let output = Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("Failed to list WSL distros".to_string());
    }

    let stdout = String::from_utf16(
        &output.stdout
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<u16>>()
    ).map_err(|_| "Failed to decode UTF-16 output from wsl.exe".to_string());

    let content = match stdout {
        Ok(s) => s,
        Err(_) => String::from_utf8_lossy(&output.stdout).to_string(),
    };

    let distros = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let name = line.trim().trim_end_matches("(Default)").trim().to_string();
            WslDistro {
                name,
                is_default: line.contains("(Default)"),
            }
        })
        .collect();

    Ok(distros)
}

#[tauri::command]
pub async fn list_wsl_directories(distro: String, path: String) -> Result<Vec<String>, String> {
    let output = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", &format!("ls -p \"{}\" | grep /", path)])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Failed to list directories: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let dirs = stdout
        .lines()
        .map(|line| line.trim_end_matches('/').to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(dirs)
}

#[tauri::command]
pub async fn get_wsl_home_directory(distro: String) -> Result<String, String> {
    let output = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", "echo $HOME"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("Failed to get home directory".to_string());
    }

    let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(home)
}

#[tauri::command]
pub async fn list_wsl_image_files(distro: String, path: String) -> Result<Vec<String>, String> {
    // List .png files in the given WSL directory, sorted by modification time (newest first)
    let cmd = format!(
        "ls -1t \"{}\" 2>/dev/null | grep -iE '\\.(png|jpg|jpeg|gif|webp)$'",
        path
    );
    let output = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", &cmd])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let files = stdout
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(files)
}

#[tauri::command]
pub async fn read_wsl_image_as_base64(distro: String, path: String) -> Result<String, String> {
    let output = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", &format!("base64 -w 0 \"{}\"", path)])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!("Failed to read file: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let lower = path.to_lowercase();
    let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub async fn delete_wsl_file(distro: String, path: String) -> Result<(), String> {
    let output = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", &format!("rm -f \"{}\"", path)])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!("Failed to delete file: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(())
}

#[tauri::command]
pub async fn write_wsl_file(distro: String, path: String, content: Vec<u8>) -> Result<(), String> {
    if let Some(unc_path) = wsl_path_to_unc(&distro, &path) {
        if let Some(parent) = unc_path.parent() {
            if std::fs::create_dir_all(parent).is_ok() && std::fs::write(&unc_path, &content).is_ok() {
                return Ok(());
            }
        }
    }

    // Compute parent directory in Rust to avoid nested quote issues in bash
    let dir = if let Some(pos) = path.rfind('/') {
        &path[..pos]
    } else {
        "/"
    };

    // Use single quotes inside bash command to avoid quoting conflicts
    let cmd = format!("mkdir -p '{}' && cat > '{}'", dir, path);

    let mut child = Command::new("wsl.exe")
        .args(["-d", &distro, "--", "bash", "-c", &cmd])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn wsl.exe: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    use std::io::Write;
    stdin.write_all(&content).map_err(|e| format!("Failed to write stdin: {}", e))?;
    drop(stdin);

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("WSL write failed for path: {}", path));
    }

    Ok(())
}

fn wsl_path_to_unc(distro: &str, path: &str) -> Option<PathBuf> {
    if !path.starts_with('/') {
        return None;
    }

    let relative_path = path.trim_start_matches('/').replace('/', "\\");
    Some(PathBuf::from(format!(
        r"\\wsl.localhost\{}\{}",
        distro, relative_path
    )))
}

#[tauri::command]
pub async fn write_wsl_base64_file(distro: String, path: String, data_url: String) -> Result<(), String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(data_url.as_str());
    let content = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    write_wsl_file(distro, path, content).await
}

fn write_wsl_file_sync(distro: &str, path: &str, content: &[u8]) -> Result<(), String> {
    if let Some(unc_path) = wsl_path_to_unc(distro, path) {
        if let Some(parent) = unc_path.parent() {
            if std::fs::create_dir_all(parent).is_ok() && std::fs::write(&unc_path, content).is_ok() {
                return Ok(());
            }
        }
    }

    let dir = if let Some(pos) = path.rfind('/') { &path[..pos] } else { "/" };
    let cmd = format!("mkdir -p '{}' && cat > '{}'", dir, path);

    let mut child = Command::new("wsl.exe")
        .args(["-d", distro, "--", "bash", "-c", &cmd])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn wsl.exe: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    use std::io::Write;
    stdin
        .write_all(content)
        .map_err(|e| format!("Failed to write stdin: {}", e))?;
    drop(stdin);

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("WSL write failed for path: {}", path));
    }

    Ok(())
}

#[tauri::command]
pub async fn queue_wsl_base64_write(distro: String, path: String, data_url: String) -> Result<(), String> {
    // Fire-and-forget background write so it never blocks the next capture.
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let encoded = data_url
                .split_once(',')
                .map(|(_, data)| data)
                .unwrap_or(data_url.as_str());
            let content = general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| format!("Failed to decode base64 image: {}", e))?;
            write_wsl_file_sync(&distro, &path, &content)
        })
        .await;
    });
    Ok(())
}
