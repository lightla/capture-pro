use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub save_target: String, // "windows" | "wsl"
    #[serde(default)]
    pub distro: String,
    #[serde(default)]
    pub save_path: String,
    #[serde(default)]
    pub windows_save_path: String,
}

#[derive(Default)]
pub struct SettingsState(pub Mutex<AppSettings>);

impl AppSettings {
    pub fn missing_save_location_message(&self) -> Option<String> {
        let target = self.save_target.trim();
        if target == "windows" {
            if self.windows_save_path.trim().is_empty() {
                return Some("⚠️ No save location. Click Settings (⚙) to configure.".to_string());
            }
            return None;
        }

        // Default to WSL if unset.
        if self.distro.trim().is_empty() || self.save_path.trim().is_empty() {
            return Some("⚠️ No save location. Click Settings (⚙) to configure.".to_string());
        }
        None
    }
}

#[tauri::command]
pub fn set_settings_cache(state: tauri::State<'_, SettingsState>, settings: AppSettings) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = settings;
    }
}
