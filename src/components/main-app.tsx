import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadSettings } from "@/lib/store";
import { WslBrowserModal } from "./wsl-browser-modal";
import {
  Settings, Camera, Pin, PinOff, EyeOff, Trash2,
  Copy, ImageIcon, RefreshCw, CheckSquare, Square,
  List, LayoutGrid, X, ChevronRight
} from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────
interface CaptureFile {
  name: string;
  path: string;
  thumbnail?: string;
}

// ── Main App ─────────────────────────────────────────────────────────────────
export function MainApp() {
  const [pinned, setPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [files, setFiles] = useState<CaptureFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"thumbnail" | "list">("thumbnail");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CaptureFile | null>(null);
  const [status, setStatus] = useState("Ready.");
  const settings = loadSettings();
  const missingSaveLocation = settings.saveTarget === "windows"
    ? !settings.windowsSavePath
    : (!settings.distro || !settings.savePath);

  const joinWindowsPath = (dir: string, name: string) => {
    const d = dir.endsWith("\\") || dir.endsWith("/") ? dir.slice(0, -1) : dir;
    return `${d}\\${name}`;
  };

  // Load gallery
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      if (settings.saveTarget === "windows") {
        if (!settings.windowsSavePath) {
          setStatus("No save location. Click ⚙ Settings to configure.");
          setFiles([]);
          return;
        }
        const names = await invoke<string[]>("list_local_image_files", { dir: settings.windowsSavePath });
        setFiles(names.map(name => ({
          name,
          path: joinWindowsPath(settings.windowsSavePath, name),
        })));
        setStatus(`${names.length} capture${names.length !== 1 ? "s" : ""} · Windows:${settings.windowsSavePath}`);
      } else {
        if (!settings.distro || !settings.savePath) {
          setStatus("No save location. Click ⚙ Settings to configure.");
          setFiles([]);
          return;
        }
        const names = await invoke<string[]>("list_wsl_image_files", {
          distro: settings.distro,
          path: settings.savePath,
        });
        setFiles(names.map(name => ({
          name,
          path: `${settings.savePath}/${name}`,
        })));
        setStatus(`${names.length} capture${names.length !== 1 ? "s" : ""} · ${settings.distro}:${settings.savePath}`);
      }
    } catch (err) {
      setStatus("Error loading captures: " + err);
    } finally {
      setLoading(false);
    }
  }, [settings.saveTarget, settings.distro, settings.savePath, settings.windowsSavePath]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Auto-refresh when window regains focus (after overlay saves a file)
  useEffect(() => {
    const onFocus = () => loadFiles();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadFiles]);


  // Load thumbnail lazily
  const loadThumb = useCallback(async (file: CaptureFile) => {
    if (file.thumbnail) return;
    try {
      const data = settings.saveTarget === "windows"
        ? await invoke<string>("read_local_image_as_base64", { path: file.path })
        : await invoke<string>("read_wsl_image_as_base64", { distro: settings.distro, path: file.path });
      setFiles(prev => prev.map(f => f.path === file.path ? { ...f, thumbnail: data } : f));
    } catch { /* ignore */ }
  }, [settings.saveTarget, settings.distro]);

  // Selection logic (Windows-style)
  const handleItemClick = useCallback((file: CaptureFile, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return next;
      });
      setLastSelected(file.path);
    } else if (e.shiftKey && lastSelected) {
      // Range
      const paths = files.map(f => f.path);
      const a = paths.indexOf(lastSelected);
      const b = paths.indexOf(file.path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(prev => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(paths[i]);
        return next;
      });
    } else {
      // Single click — preview
      setPreview(file);
      loadThumb(file);
    }
  }, [files, lastSelected, loadThumb]);

  // Actions
  const handleCapture = async () => {
    await invoke("show_overlay").catch(console.error);
  };

  const handlePin = async () => {
    const next = !pinned;
    setPinned(next);
    await invoke("set_always_on_top", { value: next }).catch(console.error);
  };

  const handleHide = async () => {
    await invoke("hide_main_window").catch(console.error);
  };

  const handleDelete = async () => {
    const toDelete = Array.from(selected);
    if (!toDelete.length) return;
    try {
      await Promise.all(toDelete.map(path =>
        settings.saveTarget === "windows"
          ? invoke("delete_local_file", { path })
          : invoke("delete_wsl_file", { distro: settings.distro, path })
      ));
      setFiles(prev => prev.filter(f => !selected.has(f.path)));
      setSelected(new Set());
      setStatus("Deleted " + toDelete.length + " file(s).");
    } catch (err) {
      setStatus("Delete failed: " + err);
    }
  };

  const handleCopyPaths = async () => {
    const paths = selected.size > 0
      ? Array.from(selected)
      : files.map(f => f.path);
    await invoke("set_clipboard_text", { text: paths.join("\n") }).catch(async () => {
      await writeText(paths.join("\n")).catch(console.error);
    });
    setStatus(`Copied ${paths.length} path(s) to clipboard.`);
  };

  const handleCopyFiles = async () => {
    const paths = selected.size > 0 ? Array.from(selected) : files.map(f => f.path);
    if (settings.saveTarget === "windows") {
      await invoke("set_clipboard_text", { text: paths.join("\n") }).catch(async () => {
        await writeText(paths.join("\n")).catch(console.error);
      });
      setStatus(`Copied ${paths.length} file path(s) to clipboard.`);
      return;
    }
    // WSL: copy UNC paths so Windows apps can access the files.
    const uncPaths = paths.map(p => `\\\\wsl.localhost\\${settings.distro}${p.replace(/\//g, "\\")}`);
    await invoke("set_clipboard_text", { text: uncPaths.join("\n") }).catch(async () => {
      await writeText(uncPaths.join("\n")).catch(console.error);
    });
    setStatus(`Copied ${uncPaths.length} UNC path(s) to clipboard.`);
  };

  const handleSelectAll = () => {
    if (selected.size === files.length && files.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map(f => f.path)));
    }
  };

  const handleSettingsSaved = () => {
    setShowSettings(false);
    loadFiles();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "a") { e.preventDefault(); handleSelectAll(); }
      if (e.key === "Delete") handleDelete();
      if (e.key === "Escape") { setSelected(new Set()); setPreview(null); }
      if (e.ctrlKey && e.key === "c") handleCopyFiles();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, files]);

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0;

  return (
    <div style={S.root}>
      {/* ── Top Toolbar ─────────────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <div style={S.logo}>
          <Camera style={{ width: 16, height: 16, color: "white" }} />
        </div>
        <span style={S.logoText}>Capture Pro <span style={{ color: "#60a5fa" }}>v2</span></span>

        <div style={S.toolbarSep} />

        <Btn icon={<Settings size={14} />} label="Settings" onClick={() => setShowSettings(true)} />
        <Btn icon={<Camera size={14} />} label="Capture" onClick={handleCapture} primary />
        <Btn
          icon={pinned ? <Pin size={14} /> : <PinOff size={14} />}
          label={pinned ? "Pinned" : "Pin"}
          onClick={handlePin}
          active={pinned}
        />
        <Btn icon={<EyeOff size={14} />} label="Hide" onClick={handleHide} />

        <div style={{ flex: 1 }} />

        <div style={S.hotkey}>⌨ Ctrl+Shift+Z</div>
      </div>

      {/* ── Gallery Toolbar ──────────────────────────────────────────────── */}
      <div style={S.galleryBar}>
        <span style={S.galleryLabel}>Captures</span>
        <button
          style={S.iconBtn}
          onClick={handleSelectAll}
          title={allSelected ? "Deselect all" : "Select all"}
        >
          {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>

        <div style={S.toolbarSep} />

        <Btn icon={<Copy size={13} />} label="Paths" onClick={handleCopyPaths} small disabled={files.length === 0} />
        <Btn icon={<ImageIcon size={13} />} label="Files (Ctrl+C)" onClick={handleCopyFiles} small disabled={files.length === 0} />

        <div style={{ flex: 1 }} />

        {someSelected && (
          <Btn icon={<Trash2 size={13} />} label={`Delete (${selected.size})`} onClick={handleDelete} small danger />
        )}
        <button style={S.iconBtn} onClick={() => setViewMode(v => v === "thumbnail" ? "list" : "thumbnail")} title="Toggle view">
          {viewMode === "thumbnail" ? <List size={14} /> : <LayoutGrid size={14} />}
        </button>
        <button style={S.iconBtn} onClick={loadFiles} title="Refresh">
          <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
        </button>
      </div>

      {/* ── Gallery Content ──────────────────────────────────────────────── */}
      <div style={S.galleryArea}>
        {files.length === 0 ? (
          <div style={S.emptyState}>
            <Camera size={36} style={{ color: "#cbd5e1", marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: "#64748b" }}>No captures yet</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Press Ctrl+Shift+Z or click Capture to start</div>
            {missingSaveLocation && (
              <button onClick={() => setShowSettings(true)} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, background: "#2563eb", color: "white", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                Configure Save Location
              </button>
            )}
          </div>
        ) : viewMode === "thumbnail" ? (
          <ThumbnailGrid
            files={files}
            selected={selected}
            onItemClick={handleItemClick}
            onLoadThumb={loadThumb}
            onBandSelect={(next, last) => {
              setSelected(next);
              if (last) setLastSelected(last);
            }}
          />
        ) : (
          <ListView
            files={files}
            selected={selected}
            onItemClick={handleItemClick}
          />
        )}
      </div>

      {/* ── Status Bar ──────────────────────────────────────────────────── */}
      <div style={S.statusBar}>
        <span style={{ color: "#64748b", fontSize: 11 }}>{status}</span>
        {someSelected && (
          <span style={{ marginLeft: "auto", color: "#3b82f6", fontSize: 11, fontWeight: 600 }}>
            {selected.size} selected
          </span>
        )}
      </div>

      {/* ── Preview Modal ─────────────────────────────────────────────── */}
      {preview && (
        <div style={S.modalBg} onClick={() => setPreview(null)}>
          <div style={S.previewBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{preview.name}</span>
              <button onClick={() => setPreview(null)} style={S.closeBtn}><X size={16} /></button>
            </div>
            {preview.thumbnail
              ? <img src={preview.thumbnail} alt={preview.name} style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 8, border: "1px solid #f1f5f9" }} />
              : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <RefreshCw size={24} style={{ color: "#94a3b8", animation: "spin 1s linear infinite" }} />
                </div>
            }
            <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 11, color: "#64748b", background: "#f8fafc", borderRadius: 8, padding: "6px 10px" }}>
              {settings.saveTarget === "windows" ? preview.path : `${settings.distro}:${preview.path}`}
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal ───────────────────────────────────────────── */}
      {showSettings && (
        <WslBrowserModal onClose={handleSettingsSaved} />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ThumbnailGrid({ files, selected, onItemClick, onLoadThumb, onBandSelect }: {
  files: CaptureFile[];
  selected: Set<string>;
  onItemClick: (f: CaptureFile, e: React.MouseEvent) => void;
  onLoadThumb: (f: CaptureFile) => void;
  onBandSelect: (next: Set<string>, lastSelected: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const bandActiveRef = useRef(false);
  const bandBaseRef = useRef<Set<string>>(new Set());
  const bandStartRef = useRef<{ x: number; y: number } | null>(null);

  const intersects = (a: DOMRect, b: { left: number; top: number; right: number; bottom: number }) => {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  };

  const updateBandSelection = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    const el = containerRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-capture-path]"));
    const hit: string[] = [];
    for (const item of items) {
      const path = item.getAttribute("data-capture-path");
      if (!path) continue;
      const r = item.getBoundingClientRect();
      if (intersects(r, { left, top, right, bottom })) hit.push(path);
    }

    const next = new Set(bandBaseRef.current);
    for (const p of hit) next.add(p);
    const last = hit.length ? hit[hit.length - 1] : null;
    onBandSelect(next, last);
  }, [onBandSelect]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!bandActiveRef.current) return;
      const start = bandStartRef.current;
      if (!start) return;
      setBand({ x1: start.x, y1: start.y, x2: e.clientX, y2: e.clientY });
      updateBandSelection(start.x, start.y, e.clientX, e.clientY);
    };
    const onUp = () => {
      if (!bandActiveRef.current) return;
      bandActiveRef.current = false;
      bandStartRef.current = null;
      setBand(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateBandSelection]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-capture-card='1']")) return;

    bandActiveRef.current = true;
    bandBaseRef.current = (e.ctrlKey || e.metaKey) ? new Set(selected) : new Set();
    bandStartRef.current = { x: e.clientX, y: e.clientY };
    setBand({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
    onBandSelect(new Set(bandBaseRef.current), null);
    e.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, padding: 14 }}
    >
      {band && (
        <div
          style={{
            position: "fixed",
            left: Math.min(band.x1, band.x2),
            top: Math.min(band.y1, band.y2),
            width: Math.abs(band.x2 - band.x1),
            height: Math.abs(band.y2 - band.y1),
            border: "1px solid rgba(69,163,255,0.95)",
            background: "rgba(69,163,255,0.12)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 99999,
          }}
        />
      )}
      {files.map(f => {
        const isSel = selected.has(f.path);
        return (
          <div
            key={f.path}
            data-capture-card="1"
            data-capture-path={f.path}
            onClick={e => onItemClick(f, e)}
            onMouseEnter={() => onLoadThumb(f)}
            style={{
              borderRadius: 10, overflow: "hidden", cursor: "pointer",
              border: isSel ? "2px solid #3b82f6" : "2px solid #e2e8f0",
              background: "white",
              boxShadow: isSel ? "0 0 0 3px rgba(59,130,246,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
              transition: "all 0.12s ease",
              position: "relative",
            }}
          >
            {isSel && (
              <div style={{ position: "absolute", top: 5, right: 5, zIndex: 2, width: 18, height: 18, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
              </div>
            )}
            <div style={{ height: 100, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {f.thumbnail
                ? <img src={f.thumbnail} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <ImageIcon size={24} style={{ color: "#e2e8f0" }} />
              }
            </div>
            <div style={{ padding: "6px 8px", fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ files, selected, onItemClick }: {
  files: CaptureFile[];
  selected: Set<string>;
  onItemClick: (f: CaptureFile, e: React.MouseEvent) => void;
}) {
  return (
    <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      {files.map(f => {
        const isSel = selected.has(f.path);
        return (
          <div
            key={f.path}
            onClick={e => onItemClick(f, e)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              background: isSel ? "#eff6ff" : "white",
              border: isSel ? "1px solid #93c5fd" : "1px solid #e8edf3",
              fontSize: 12, color: "#334155",
              transition: "all 0.1s ease",
            }}
          >
            <ImageIcon size={14} style={{ color: "#60a5fa", flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            <ChevronRight size={12} style={{ color: "#cbd5e1" }} />
          </div>
        );
      })}
    </div>
  );
}

function Btn({ icon, label, onClick, primary, active, small, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  primary?: boolean; active?: boolean; small?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: small ? 5 : 6,
        padding: small ? "5px 10px" : "6px 12px",
        borderRadius: 8,
        border: danger ? "1px solid #fecaca" : active ? "1px solid #93c5fd" : "1px solid #e2e8f0",
        background: primary ? "#2563eb" : danger ? "#fef2f2" : active ? "#eff6ff" : "white",
        color: primary ? "white" : danger ? "#dc2626" : active ? "#2563eb" : "#374151",
        fontSize: small ? 12 : 13, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        boxShadow: primary ? "0 2px 8px rgba(37,99,235,0.25)" : "none",
        transition: "all 0.12s ease",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100vh", background: "#f8fafc", fontFamily: "system-ui, sans-serif", overflow: "hidden" },
  toolbar: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "white", borderBottom: "1px solid #e8edf3", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  logo: { width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  logoText: { fontSize: 14, fontWeight: 700, color: "#1e293b", marginRight: 4 },
  toolbarSep: { width: 1, height: 20, background: "#e8edf3", margin: "0 2px" },
  hotkey: { fontSize: 11, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "4px 8px", border: "1px solid #e2e8f0" },
  galleryBar: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#fafbfc", borderBottom: "1px solid #e8edf3" },
  galleryLabel: { fontSize: 12, fontWeight: 600, color: "#374151", marginRight: 2 },
  iconBtn: { width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", flexShrink: 0 },
  galleryArea: { flex: 1, overflowY: "auto" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40 },
  statusBar: { display: "flex", alignItems: "center", padding: "5px 14px", background: "white", borderTop: "1px solid #e8edf3", minHeight: 28 },
  modalBg: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  previewBox: { background: "white", borderRadius: 16, padding: 20, maxWidth: "80vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "auto" },
  closeBtn: { width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" },
};
