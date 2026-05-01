import { useState } from "react";
import { loadSettings, saveSettings } from "@/lib/store";
import { Keyboard, FolderOpen, Monitor, Info } from "lucide-react";

export function SettingsPanel() {
  const [settings, setSettings] = useState(loadSettings);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof typeof settings, val: string) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const modeBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 0", borderRadius: 8, border: active ? "1px solid #3b82f6" : "1px solid #e2e8f0",
    background: active ? "#eff6ff" : "white", color: active ? "#2563eb" : "#64748b",
    fontWeight: active ? 600 : 400, fontSize: 12, cursor: "pointer", transition: "all 0.15s ease"
  });

  const s: Record<string, React.CSSProperties> = {
    section: { background: "white", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 12 },
    sectionHeader: { padding: "12px 16px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc", display: "flex", alignItems: "center", gap: 8 },
    sectionTitle: { fontWeight: 600, fontSize: 13, color: "#1e293b" },
    sectionBody: { padding: 16, display: "flex", flexDirection: "column", gap: 14 },
    field: { display: "flex", flexDirection: "column", gap: 6 },
    label: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em" },
    hint: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
    readonlyBox: { padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #f1f5f9", fontFamily: "monospace", fontSize: 12, color: "#64748b" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Hotkeys */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <Keyboard style={{ width: 15, height: 15, color: "#2563eb" }} />
          <span style={s.sectionTitle}>Hotkeys</span>
          <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>Global shortcuts (always active)</span>
        </div>
        <div style={s.sectionBody}>
          <div style={s.field}>
            <label style={s.label}>Capture Hotkey</label>
            <div style={s.readonlyBox}>Ctrl + Shift + Z</div>
            <div style={s.hint}>Opens the screen capture overlay</div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Paste Hotkey</label>
            <div style={s.readonlyBox}>Ctrl + Shift + V</div>
            <div style={s.hint}>Pastes the latest capture into the active app</div>
          </div>
          <div style={{ padding: "8px 12px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", fontSize: 11, color: "#92400e" }}>
            ⚠️ Hotkey customization coming soon. Restart the app after changing settings.
          </div>
        </div>
      </div>

      {/* Save Location */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <FolderOpen style={{ width: 15, height: 15, color: "#2563eb" }} />
          <span style={s.sectionTitle}>Save Location</span>
        </div>
        <div style={s.sectionBody}>
          <div style={s.field}>
            <label style={s.label}>Save To</label>
            <div style={s.readonlyBox}>{settings.saveTarget === "windows" ? "Windows" : "WSL"}</div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Folder</label>
            <div style={s.readonlyBox}>
              {settings.saveTarget === "windows"
                ? (settings.windowsSavePath || "Not set — open Settings (⚙) to configure")
                : (settings.distro && settings.savePath ? `${settings.distro}:${settings.savePath}` : "Not set — open Settings (⚙) to configure")
              }
            </div>
          </div>
        </div>
      </div>

      {/* Clipboard Mode */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <Monitor style={{ width: 15, height: 15, color: "#2563eb" }} />
          <span style={s.sectionTitle}>Clipboard Mode</span>
        </div>
        <div style={s.sectionBody}>
          <div style={s.field}>
            <label style={s.label}>After Capture, copy to clipboard as:</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={modeBtn(settings.clipboardMode === "paths")}
                onClick={() => update("clipboardMode", "paths")}
              >
                📋 Paths
              </button>
              <button
                style={modeBtn(settings.clipboardMode === "files")}
                onClick={() => update("clipboardMode", "files")}
              >
                📁 Files
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <Monitor style={{ width: 15, height: 15, color: "#2563eb" }} />
          <span style={s.sectionTitle}>Gallery</span>
          <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>RAM-saving view</span>
        </div>
        <div style={s.sectionBody}>
          <div style={s.field}>
            <label style={s.label}>Default Gallery View</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={modeBtn(settings.galleryMode !== "focus")}
                onClick={() => update("galleryMode", "all")}
              >
                🖼️ All
              </button>
              <button
                style={modeBtn(settings.galleryMode === "focus")}
                onClick={() => update("galleryMode", "focus")}
              >
                🎯 Focus (Latest)
              </button>
            </div>
            <div style={s.hint}>Focus mode only shows the newest capture to reduce memory usage.</div>
          </div>
        </div>
      </div>

      {/* About */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <Info style={{ width: 15, height: 15, color: "#2563eb" }} />
          <span style={s.sectionTitle}>About</span>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>Capture Pro</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>v2.0.0 — Tauri + Rust + React</div>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Built for WSL developers</div>
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <button
          onClick={handleSave}
          style={{
            padding: "10px 28px",
            borderRadius: 10,
            background: saved
              ? "linear-gradient(135deg, #16a34a, #15803d)"
              : "linear-gradient(135deg, #3b82f6, #2563eb)",
            color: saved ? "white" : "#93c5fd",
            border: "none",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: saved
              ? "0 4px 12px rgba(22,163,74,0.28)"
              : "0 4px 12px rgba(37,99,235,0.25)",
            transition: "all 0.2s ease"
          }}
        >
          {saved ? "✓ Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
