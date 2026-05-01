// Shared state store using localStorage
// Used to sync settings between main window and overlay window

export interface AppSettings {
  distro: string;
  savePath: string;
  captureHotkey: string;
  pasteHotkey: string;
  clipboardMode: "paths" | "files";
}

const SETTINGS_KEY = "capture-pro-settings";

export const defaultSettings: AppSettings = {
  distro: "",
  savePath: "/home",
  captureHotkey: "Ctrl+Shift+Z",
  pasteHotkey: "Ctrl+Shift+V",
  clipboardMode: "paths",
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
  return updated;
}
