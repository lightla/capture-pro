import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "@/lib/store";
import { Folder, ChevronRight, Home, Check, X, ChevronUp, ChevronDown, CheckSquare, Square } from "lucide-react";

interface WslDistro { name: string; is_default: boolean; }

function tryParseWslUncPath(picked: string): { distro: string; path: string } | null {
  const p = (picked || "").trim();
  const m =
    p.match(/^\\\\wsl\.localhost\\([^\\]+)\\(.*)$/i) ||
    p.match(/^\\\\wsl\\([^\\]+)\\(.*)$/i);
  if (!m) return null;
  const distro = (m[1] || "").trim();
  const rest = (m[2] || "").replace(/\\/g, "/");
  const path = "/" + rest.replace(/^\/+/, "");
  if (!distro || !path.startsWith("/")) return null;
  return { distro, path: path === "/" ? "/" : path.replace(/\/+$/g, "") };
}

function WindowsMark({ size = 14 }: { size?: number }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="#dbeafe" />
      <rect x="1" y="1" width="6" height="6" rx="1.2" fill="#60a5fa" />
      <rect x="9" y="1" width="6" height="6" rx="1.2" fill="#3b82f6" />
      <rect x="1" y="9" width="6" height="6" rx="1.2" fill="#3b82f6" />
      <rect x="9" y="9" width="6" height="6" rx="1.2" fill="#2563eb" />
    </svg>
  );
}

export function WslBrowserModal({ onClose }: { onClose: () => void }) {
  const cfg = loadSettings();
  const [distros, setDistros] = useState<WslDistro[]>([]);
  const [saveTarget, setSaveTarget] = useState<"wsl" | "windows">(cfg.saveTarget || "wsl");
  const [distro, setDistro] = useState(cfg.distro || "");
  const [path, setPath] = useState(cfg.savePath || "/");
  const [winPath, setWinPath] = useState(cfg.windowsSavePath || "");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [winDirs, setWinDirs] = useState<string[]>([]);
  const [winLoading, setWinLoading] = useState(false);
  const [clipMode, setClipMode] = useState<"paths"|"files">(cfg.clipboardMode || "paths");
  const [captureHotkey, setCaptureHotkey] = useState(cfg.captureHotkey || "Ctrl+Shift+Z");
  const [simulateHotkey, setSimulateHotkey] = useState(cfg.pasteHotkey || "Ctrl+Shift+V");
  const [simulateEnabled, setSimulateEnabled] = useState(cfg.simulatePasteEnabled ?? true);
  const [recording, setRecording] = useState<null | "capture" | "simulate">(null);
  const recordingDraftRef = useRef<string | null>(null);
  const [recordingDraft, setRecordingDraft] = useState<string | null>(null);
  const hotkeysSuspendedRef = useRef(false);
  const savedRef = useRef(false);
  const [error, setError] = useState("");
  const [systemPickBusy, setSystemPickBusy] = useState(false);
  const [showDistroMenu, setShowDistroMenu] = useState(false);
  const distroMenuRef = useRef<HTMLDivElement | null>(null);

  const BTN_BORDER = "#cbd5e1";
  const BTN_BG = "#f8fafc";

  const formatHotkeyFromEvent = (e: KeyboardEvent): string | null => {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Meta");

    // Prefer `code` so layout/language doesn't break capture (e.g. VN layout).
    const code = (e.code || "").trim();
    if (!code) return null;
    if (code === "ControlLeft" || code === "ControlRight" || code === "ShiftLeft" || code === "ShiftRight" || code === "AltLeft" || code === "AltRight" || code === "MetaLeft" || code === "MetaRight") {
      return null;
    }

    let mainKey = "";
    if (code.startsWith("Key") && code.length === 4) {
      mainKey = code.slice(3).toUpperCase();
    } else if (code.startsWith("Digit") && code.length === 6) {
      mainKey = code.slice(5);
    } else if (/^F\d{1,2}$/.test(code)) {
      mainKey = code;
    } else if (code.startsWith("Numpad") && code.length === 7) {
      const n = code.slice(6);
      if (/^\d$/.test(n)) mainKey = `Num${n}`;
    }

    // Fallback to `key` for any remaining supported single-char keys.
    if (!mainKey) {
      const key = (e.key || "").trim();
      if (!key) return null;
      if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
      if (key.length === 1) {
        const ch = key.toUpperCase();
        if (/[A-Z0-9]/.test(ch)) mainKey = ch;
      } else if (/^F\d{1,2}$/.test(key.toUpperCase())) {
        mainKey = key.toUpperCase();
      }
    }

    if (!mainKey) return null;
    parts.push(mainKey);
    return parts.join("+");
  };

  const setRecordingMode = async (mode: null | "capture" | "simulate") => {
    if (mode) {
      if (!hotkeysSuspendedRef.current) {
        hotkeysSuspendedRef.current = true;
        await invoke("set_hotkey_recording", { value: true }).catch(() => {});
      }
    }
    setRecording(mode);
    // Ensure the webview has focus so keydown events are delivered while recording.
    try { window.focus(); } catch {}
    if (!mode) {
      recordingDraftRef.current = null;
      setRecordingDraft(null);
    }
  };

  useEffect(() => {
    if (!recording) return;

    // Focus the active webview so key events are delivered.
    try { window.focus(); } catch {}

    const commitIfReady = (e: KeyboardEvent) => {
      // Commit when user released all modifiers (so holding Ctrl+Shift+Z works).
      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      const hk = recordingDraftRef.current;
      if (!hk) return;
      if (recording === "capture") setCaptureHotkey(hk);
      if (recording === "simulate") setSimulateHotkey(hk);
      setRecording(null);
      recordingDraftRef.current = null;
      setRecordingDraft(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const hotkey = formatHotkeyFromEvent(e);
      if (!hotkey) return;
      recordingDraftRef.current = hotkey;
      setRecordingDraft(hotkey);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      commitIfReady(e);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording]);

  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        invoke("restore_hotkeys").catch(() => {});
      }
    };
  }, []);

  const pickWindowsFolder = async (defaultPath: string | null) => {
    setSystemPickBusy(true);
    try {
      return await invoke<string | null>("pick_windows_folder", { default_path: defaultPath }).catch(() => null);
    } finally {
      setSystemPickBusy(false);
    }
  };

  const systemPickWsl = async () => {
    if (!distro) return;
    setError("");
    const picked = await pickWindowsFolder(null);
    if (!picked) return;
    const unc = tryParseWslUncPath(picked);
    if (unc) {
      const inList = distros.length === 0 || distros.some(d => d.name === unc.distro);
      if (!inList) {
        setError(`Picked a WSL folder in '${unc.distro}', but that distro isn't available.`);
        return;
      }
      if (unc.distro !== distro) {
        setDistro(unc.distro);
      }
      setPath(unc.path || "/");
      return;
    }

    try {
      const converted = await invoke<string>("windows_path_to_wsl", { distro, windows_path: picked });
      setPath((converted || "").trim() || "/");
    } catch (e) {
      setError(String(e || "Failed to convert path via wslpath"));
    }
  };

  const systemPickWindows = async () => {
    const picked = await pickWindowsFolder(winNormalize(winPath) || null);
    if (picked) setWinPath(picked);
  };

  useEffect(() => {
    if (saveTarget !== "wsl") return;
    invoke<WslDistro[]>("list_wsl_distros").then(list => {
      setDistros(list);
      if (!distro && list.length > 0) {
        const d = list.find(x => x.is_default) || list[0];
        setDistro(d.name);
      }
    }).catch(() => setError("Cannot list WSL distros"));
  }, [saveTarget]);

  useEffect(() => {
    if (!showDistroMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (distroMenuRef.current && distroMenuRef.current.contains(t)) return;
      setShowDistroMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showDistroMenu]);

  useEffect(() => {
    if (saveTarget !== "wsl") return;
    if (!distro) return;
    setLoading(true);
    setDirs([]);
    invoke<string[]>("list_wsl_directories", { distro, path })
      .then(setDirs)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [saveTarget, distro, path]);

  useEffect(() => {
    if (saveTarget !== "windows") return;

    const run = async () => {
      try {
        let p = (winPath || "").trim();
        if (!p) {
          p = await invoke<string>("get_local_home_directory").catch(() => "C:\\");
          p = (p || "").trim();
          if (!p) p = "C:\\";
          setWinPath(p);
        }

        setWinLoading(true);
        setWinDirs([]);
        const list = await invoke<string[]>("list_local_directories", { path: p });
        setWinDirs(list);
      } catch (e) {
        setError(String(e));
      } finally {
        setWinLoading(false);
      }
    };

    run();
  }, [saveTarget, winPath]);

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

  const winNormalize = (p: string) => {
    const s = (p || "").replace(/\//g, "\\").trim();
    if (/^[a-zA-Z]:\\?$/.test(s)) return s.endsWith("\\") ? s : `${s}\\`;
    return s.replace(/\\+$/g, "");
  };

  const winGoHome = async () => {
    const home = await invoke<string>("get_local_home_directory").catch(() => "C:\\");
    setWinPath(winNormalize(home));
  };

  const winGoUp = () => {
    const p = winNormalize(winPath);
    if (/^[a-zA-Z]:\\$/.test(p)) return;
    const idx = p.lastIndexOf("\\");
    if (idx <= 2) {
      setWinPath(p.slice(0, 2) + "\\");
      return;
    }
    setWinPath(p.slice(0, idx));
  };

  const winEnter = (dir: string) => {
    const base = winNormalize(winPath);
    if (/^[a-zA-Z]:\\$/.test(base)) setWinPath(base + dir);
    else setWinPath(base + "\\" + dir);
  };

  const handleSave = async () => {
    setError("");

    // Apply hotkeys first so any registration errors are shown before closing.
    const ok = await invoke("set_hotkeys", { capture: captureHotkey, simulate: simulateHotkey, enableSimulate: simulateEnabled })
      .then(() => true)
      .catch((e) => {
        setError(String(e || "Failed to register hotkeys"));
        return false;
      });
    if (!ok) return;

    saveSettings({
      saveTarget,
      distro: saveTarget === "wsl" ? distro : "",
      savePath: saveTarget === "wsl" ? path : "",
      windowsSavePath: saveTarget === "windows" ? winNormalize(winPath) : "",
      clipboardMode: clipMode,
      captureHotkey,
      pasteHotkey: simulateHotkey,
      simulatePasteEnabled: simulateEnabled,
    });
    savedRef.current = true;
    hotkeysSuspendedRef.current = false;
    onClose();
  };

  const breadcrumbs = path.split("/").filter(Boolean);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
        <div style={{ background: "white", borderRadius: 16, width: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, #f8faff, #f1f5fb)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Settings</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>Configure save location & clipboard</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${BTN_BORDER}`, background: BTN_BG, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Target */}
          <div>
            <label style={L.label}>Save To</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["windows", "wsl"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setSaveTarget(t); setError(""); }}
                  style={{
                    flex: 1,
                    height: 44,
                    padding: 0,
                    borderRadius: 10,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    transition: "all 0.15s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: saveTarget === t ? "1px solid #93c5fd" : `1px solid ${BTN_BORDER}`,
                    background: saveTarget === t ? "#eff6ff" : BTN_BG,
                    color: saveTarget === t ? "#2563eb" : "#64748b",
                  }}
                >
                  {t === "windows" ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: "100%" }}>
                      <span style={{ width: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <WindowsMark size={14} />
                      </span>
                      <span style={{ lineHeight: 1 }}>Windows</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: "100%" }}>
                      <span style={{ width: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, lineHeight: 1 }}>🐧</span>
                      <span style={{ lineHeight: 1 }}>WSL</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Distro */}
          {saveTarget === "wsl" && (
          <div>
            <label style={L.label}>WSL Distribution</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div ref={distroMenuRef} style={{ position: "relative", flex: 1 }}>
                <button
                  onClick={() => setShowDistroMenu(v => !v)}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: showDistroMenu ? "1px solid #93c5fd" : `1px solid ${BTN_BORDER}`,
                    background: BTN_BG,
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "0 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    boxShadow: showDistroMenu ? "0 4px 16px rgba(59,130,246,0.18)" : "0 1px 3px rgba(0,0,0,0.06)",
                    color: distro ? "#0f172a" : "#94a3b8",
                    outline: "none",
                  }}
                  title={distro ? distro : "Select a distro"}
                >
                  <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {distro || (distros.length ? "Select a distro..." : "Loading...")}
                  </span>
                  <ChevronDown size={14} style={{ color: showDistroMenu ? "#2563eb" : "#94a3b8", flexShrink: 0 }} />
                </button>

                {showDistroMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      zIndex: 10060,
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      boxShadow: "0 16px 40px rgba(15,23,42,0.16)",
                      padding: 6,
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {distros.map(d => {
                      const active = d.name === distro;
                      return (
                        <button
                          key={d.name}
                          onClick={() => {
                            setDistro(d.name);
                            setPath("/");
                            setShowDistroMenu(false);
                            setError("");
                          }}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 10px",
                            borderRadius: 8,
                            border: active ? "1px solid #93c5fd" : "1px solid transparent",
                            background: active ? "#eff6ff" : "transparent",
                            cursor: "pointer",
                            color: active ? "#2563eb" : "#0f172a",
                            fontSize: 13,
                            fontWeight: active ? 700 : 600,
                            textAlign: "left",
                          }}
                          onMouseEnter={(e) => {
                            const el = e.currentTarget as HTMLButtonElement;
                            if (active) return;
                            el.style.background = "#eff6ff";
                            el.style.color = "#2563eb";
                          }}
                          onMouseLeave={(e) => {
                            const el = e.currentTarget as HTMLButtonElement;
                            if (active) return;
                            el.style.background = "transparent";
                            el.style.color = "#0f172a";
                          }}
                        >
                          <span style={{ width: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {active ? <Check size={14} /> : null}
                          </span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {d.name}{d.is_default ? " (Default)" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={goHome} style={L.iconBtn} title="Go to home"><Home size={14} /></button>
            </div>
          </div>
          )}

          {/* Save path browser */}
          {saveTarget === "wsl" ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={L.label}>Save Location</label>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{distro}:{path}</span>
            </div>

            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
              Choose a folder below, or use{" "}
              <button
                onClick={systemPickWsl}
                disabled={!distro || systemPickBusy}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  cursor: !distro || systemPickBusy ? "not-allowed" : "pointer",
                  color: "#2563eb",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  lineHeight: "inherit",
                  textDecoration: "none",
                  opacity: !distro || systemPickBusy ? 0.5 : 1,
                }}
                title="Open System Picker (Windows folder picker)"
              >
                System Picker
              </button>
              .
            </div>

            {/* Breadcrumb */}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, padding: "8px 12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #cbd5e1", marginBottom: 8, fontSize: 12 }}>
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
            <div style={{ height: 220, overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, background: "#fafafa" }}>
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
          ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={L.label}>Save Location</label>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{winNormalize(winPath) || "—"}</span>
            </div>

            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
              Choose a folder below, or use{" "}
              <button
                onClick={systemPickWindows}
                disabled={systemPickBusy}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  cursor: systemPickBusy ? "not-allowed" : "pointer",
                  color: "#2563eb",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  lineHeight: "inherit",
                  textDecoration: "none",
                  opacity: systemPickBusy ? 0.5 : 1,
                }}
                title="Open System Picker"
              >
                System Picker
              </button>
              .
            </div>

            {(() => {
              const p = winNormalize(winPath) || "C:\\";
              const m = p.match(/^([a-zA-Z]:)\\?(.*)$/);
              const drive = m?.[1] || "C:";
              const rest = (m?.[2] || "").split("\\").filter(Boolean);
              const crumbs = [drive, ...rest];
              const atRoot = /^[a-zA-Z]:\\$/.test(p);
              const buildTo = (i: number) => {
                if (i === 0) return `${drive}\\`;
                return `${drive}\\${rest.slice(0, i).join("\\")}`;
              };

              return (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, padding: "8px 12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #cbd5e1", marginBottom: 8, fontSize: 12 }}>
                  {crumbs.map((part, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      {i > 0 && <ChevronRight size={11} style={{ color: "#cbd5e1" }} />}
                      <span onClick={() => setWinPath(buildTo(i))} style={L.crumb(i === crumbs.length - 1)}>{part}</span>
                    </span>
                  ))}
                  <button onClick={winGoHome} style={{ marginLeft: "auto", ...L.iconBtn }} title="Home"><Home size={14} /></button>
                  {!atRoot && (
                    <button onClick={winGoUp} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>
                      <ChevronUp size={11} /> Up
                    </button>
                  )}
                </div>
              );
            })()}

            <div style={{ height: 220, overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, background: "#fafafa" }}>
              {winLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8, color: "#94a3b8" }}>
                  <div style={{ width: 24, height: 24, border: "2px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 12 }}>Scanning...</span>
                </div>
              ) : winDirs.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 6, color: "#94a3b8" }}>
                  <span style={{ fontSize: 24 }}>📁</span>
                  <span style={{ fontSize: 12 }}>No subdirectories — you can select this folder</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {winDirs.map(dir => (
                    <button key={dir} onClick={() => winEnter(dir)} style={L.dirBtn}
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
          )}

          {/* Clipboard mode */}
          <div>
            <label style={L.label}>Clipboard Storage</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["paths", "files"] as const).map(mode => (
                <button key={mode} onClick={() => setClipMode(mode)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 500, transition: "all 0.15s",
                  border: clipMode === mode ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                  background: clipMode === mode ? "#eff6ff" : "white",
                  color: clipMode === mode ? "#2563eb" : "#64748b",
                }}>
                  {mode === "paths" ? "📋 Paths" : "📁 Files"}
                </button>
              ))}
            </div>
            {clipMode === "paths" && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 4, lineHeight: "16px" }}>
                <span style={{ color: "#64748b" }}>Simulate paste image from copied path</span>
                <button
                  type="button"
                  onClick={() => setSimulateEnabled(v => !v)}
                  title="Toggle simulate paste"
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    verticalAlign: "middle",
                    color: simulateEnabled ? "#2563eb" : "#94a3b8",
                  }}
                >
                  {simulateEnabled ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
              </div>
            )}
          </div>

          {/* Hotkeys */}
          <div>
            <label style={L.label}>Hotkeys</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Capture</div>
                <button
                  type="button"
                  onClick={() => { void setRecordingMode(recording === "capture" ? null : "capture"); }}
                  style={{
                    height: 38,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "white",
                    fontSize: 12,
                    fontFamily: "monospace",
                    color: "#334155",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {recording === "capture" ? (recordingDraft || "Press keys...") : captureHotkey}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Simulate Paste</div>
                <button
                  type="button"
                  disabled={!simulateEnabled || clipMode !== "paths"}
                  onClick={() => { void setRecordingMode(recording === "simulate" ? null : "simulate"); }}
                  style={{
                    height: 38,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    background: "white",
                    fontSize: 12,
                    fontFamily: "monospace",
                    color: "#334155",
                    cursor: (!simulateEnabled || clipMode !== "paths") ? "not-allowed" : "pointer",
                    opacity: (!simulateEnabled || clipMode !== "paths") ? 0.55 : 1,
                    textAlign: "left",
                  }}
                >
                  {recording === "simulate" ? (recordingDraft || "Press keys...") : simulateHotkey}
                </button>
              </div>
            </div>
          </div>

          {error && <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 8, fontSize: 12 }}>⚠️ {error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafbfc" }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {saveTarget === "wsl" ? (
              <>
                <span style={{ color: "#2563eb", fontWeight: 600 }}>{distro || "—"}</span>
                <span style={{ margin: "0 6px", color: "#cbd5e1" }}>›</span>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{path}</span>
              </>
            ) : (
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{winNormalize(winPath) || "—"}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${BTN_BORDER}`, background: BTN_BG, cursor: "pointer", fontSize: 13, color: "#64748b" }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: "9px 22px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#bfdbfe", cursor: "pointer", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
              Save
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
  iconBtn: { width: 38, height: 38, borderRadius: 9, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" } as React.CSSProperties,
  crumb: (active: boolean) => ({ cursor: active ? "default" : "pointer", color: active ? "#1e293b" : "#3b82f6", fontWeight: active ? 700 : 500, padding: "1px 4px", borderRadius: 4, background: active ? "#f1f5f9" : "transparent" }) as React.CSSProperties,
  dirBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "white", border: "1px solid #e8edf3", borderRadius: 10, fontSize: 12, color: "#334155", cursor: "pointer", transition: "all 0.12s", width: "100%", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" } as React.CSSProperties,
};
