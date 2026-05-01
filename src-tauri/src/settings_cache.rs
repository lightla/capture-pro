use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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
    #[serde(default)]
    pub clipboard_mode: String, // "paths" | "files"
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
pub fn set_settings_cache(app: tauri::AppHandle, state: tauri::State<'_, SettingsState>, settings: AppSettings) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = settings;
    }

    // If user chooses clipboard mode "files", Ctrl+Shift+V is not needed (Ctrl+V will paste file).
    // Avoid registering hotkeys we don't use to reduce conflicts with other apps.
    let mode = app
        .try_state::<SettingsState>()
        .and_then(|s| s.0.lock().ok().map(|g| g.clipboard_mode.clone()))
        .unwrap_or_default();

    let enable_paste_hotkeys = mode.trim().is_empty() || mode.trim() == "paths";

    let paste_hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV);
    let paste_hotkey_alt = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV);

    if enable_paste_hotkeys {
        let _ = app.global_shortcut().register(paste_hotkey);
        let _ = app.global_shortcut().register(paste_hotkey_alt);
    } else {
        let _ = app.global_shortcut().unregister(paste_hotkey);
        let _ = app.global_shortcut().unregister(paste_hotkey_alt);
    }
}
