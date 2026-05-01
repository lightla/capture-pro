// Shared state store using localStorage
// Used to sync settings between main window and overlay window
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  saveTarget: "wsl" | "windows";
  distro: string;
  savePath: string;
  windowsSavePath: string;
  captureHotkey: string;
  pasteHotkey: string;
  clipboardMode: "paths" | "files";
  galleryMode: "all" | "focus";
  dockColumns: 1 | 2;
}

const SETTINGS_KEY = "capture-pro-settings";

export const defaultSettings: AppSettings = {
  saveTarget: "wsl",
  distro: "",
  savePath: "/home",
  windowsSavePath: "",
  captureHotkey: "Ctrl+Shift+Z",
  pasteHotkey: "Ctrl+Shift+V",
  clipboardMode: "paths",
  galleryMode: "all",
  dockColumns: 1,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Partial<AppSettings>) {
  const current = loadSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));

  // Keep a lightweight settings cache in Rust so global hotkeys can validate config
  // before opening the overlay (so we can toast in the main window).
  invoke("set_settings_cache", {
    settings: {
      save_target: updated.saveTarget,
      distro: updated.distro,
      save_path: updated.savePath,
      windows_save_path: updated.windowsSavePath,
      clipboard_mode: updated.clipboardMode,
    },
  }).catch(() => {});
  return updated;
}
