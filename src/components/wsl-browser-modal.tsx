import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "@/lib/store";
import { Folder, ChevronRight, Home, Check, X, ChevronUp } from "lucide-react";

interface WslDistro { name: string; is_default: boolean; }

export function WslBrowserModal({ onClose }: { onClose: () => void }) {
  const cfg = loadSettings();
  const [distros, setDistros] = useState<WslDistro[]>([]);
  const [distro, setDistro] = useState(cfg.distro || "");
  const [path, setPath] = useState(cfg.savePath || "/");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [clipMode, setClipMode] = useState<"paths"|"files">(cfg.clipboardMode || "paths");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<WslDistro[]>("list_wsl_distros").then(list => {
      setDistros(list);
      if (!distro && list.length > 0) {
        const d = list.find(x => x.is_default) || list[0];
        setDistro(d.name);
      }
    }).catch(() => setError("Cannot list WSL distros"));
  }, []);

  useEffect(() => {
    if (!distro) return;
    setLoading(true);
    setDirs([]);
    invoke<string[]>("list_wsl_directories", { distro, path })
      .then(setDirs)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [distro, path]);

  const goHome = async () => {
    const home = await invoke<string>("get_wsl_home_directory", { distro }).catch(() => "/home");
    setPath(home.trim() || "/home");
  };

  const goUp = () => {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath("/" + parts.join("/") || "/");
  };

  const enter = (dir: string) => {
    setPath(path === "/" ? `/${dir}` : `${path}/${dir}`);
  };

  const handleSave = () => {
    saveSettings({ distro, savePath: path, clipboardMode: clipMode });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const breadcrumbs = path.split("/").filter(Boolean);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "white", borderRadius: 16, width: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, #f8faff, #f1f5fb)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Settings</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>Configure save location & clipboard</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Distro */}
          <div>
            <label style={L.label}>WSL Distribution</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={distro}
                onChange={e => { setDistro(e.target.value); setPath("/"); }}
                style={{ flex: 1, height: 38, borderRadius: 9, border: "1px solid #e2e8f0", padding: "0 12px", fontSize: 13, background: "#fafbfc", outline: "none" }}
              >
                {distros.length === 0 && <option value="">Loading...</option>}
                {distros.map(d => (
                  <option key={d.name} value={d.name}>{d.name}{d.is_default ? " (Default)" : ""}</option>
                ))}
              </select>
              <button onClick={goHome} style={L.iconBtn} title="Go to home"><Home size={14} /></button>
            </div>
          </div>

          {/* Save path browser */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={L.label}>Save Location</label>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{distro}:{path}</span>
            </div>

            {/* Breadcrumb */}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, padding: "8px 12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #f1f5f9", marginBottom: 8, fontSize: 12 }}>
              <span onClick={() => setPath("/")} style={L.crumb("/"===path)}>root</span>
              {breadcrumbs.map((part, i) => {
                const to = "/" + breadcrumbs.slice(0, i+1).join("/");
                return (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <ChevronRight size={11} style={{ color: "#cbd5e1" }} />
                    <span onClick={() => setPath(to)} style={L.crumb(i === breadcrumbs.length-1)}>{part}</span>
                  </span>
                );
              })}
              {path !== "/" && (
                <button onClick={goUp} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>
                  <ChevronUp size={11} /> Up
                </button>
              )}
            </div>

            {/* Dir grid */}
            <div style={{ height: 220, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 12, padding: 10, background: "#fafafa" }}>
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8, color: "#94a3b8" }}>
                  <div style={{ width: 24, height: 24, border: "2px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 12 }}>Scanning...</span>
                </div>
              ) : dirs.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 6, color: "#94a3b8" }}>
                  <span style={{ fontSize: 24 }}>📂</span>
                  <span style={{ fontSize: 12 }}>No subdirectories — you can select this folder</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {dirs.map(dir => (
                    <button key={dir} onClick={() => enter(dir)} style={L.dirBtn}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#93c5fd"; (e.currentTarget as HTMLElement).style.background = "#eff6ff"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e8edf3"; (e.currentTarget as HTMLElement).style.background = "white"; }}>
                      <Folder size={14} style={{ color: "#60a5fa", flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{dir}</span>
                      <ChevronRight size={12} style={{ color: "#cbd5e1", flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clipboard mode */}
          <div>
            <label style={L.label}>Clipboard Mode (after capture)</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["paths", "files"] as const).map(mode => (
                <button key={mode} onClick={() => setClipMode(mode)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 500, transition: "all 0.15s",
                  border: clipMode === mode ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                  background: clipMode === mode ? "#eff6ff" : "white",
                  color: clipMode === mode ? "#2563eb" : "#64748b",
                }}>
                  {mode === "paths" ? "📋 Paths (for Agent)" : "📁 Files (paste into apps)"}
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 8, fontSize: 12 }}>⚠️ {error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafbfc" }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            <span style={{ color: "#2563eb", fontWeight: 600 }}>{distro || "—"}</span>
            <span style={{ margin: "0 6px", color: "#cbd5e1" }}>›</span>
            <span style={{ fontFamily: "monospace", fontSize: 11 }}>{path}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 13, color: "#64748b" }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: "9px 22px", borderRadius: 10, border: "none", background: saved ? "#16a34a" : "#2563eb", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
              {saved && <Check size={14} />} {saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const L: any = {
  label: { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 8 } as React.CSSProperties,
  iconBtn: { width: 38, height: 38, borderRadius: 9, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" } as React.CSSProperties,
  crumb: (active: boolean) => ({ cursor: active ? "default" : "pointer", color: active ? "#1e293b" : "#3b82f6", fontWeight: active ? 700 : 500, padding: "1px 4px", borderRadius: 4, background: active ? "#f1f5f9" : "transparent" }) as React.CSSProperties,
  dirBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "white", border: "1px solid #e8edf3", borderRadius: 10, fontSize: 12, color: "#334155", cursor: "pointer", transition: "all 0.12s", width: "100%", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" } as React.CSSProperties,
};
