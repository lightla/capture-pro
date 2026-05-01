import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/store";
import { WslBrowserModal } from "./wsl-browser-modal";
import {
  Settings, Camera, Pin, PinOff, EyeOff, Trash2,
  Copy, ImageIcon, RefreshCw, CheckSquare, Square,
  List, LayoutGrid, X, ChevronRight, Target, ChevronsRight, ChevronDown, PanelTop
} from "lucide-react";

// ── types ────────────────────────────────────────────────────────────────────
interface CaptureFile {
  name: string;
  path: string;
  thumbnail?: string;
}

interface DockResult {
  docked: boolean;
  alwaysOnTop: boolean;
}

const COMPACT_WIDTH = 210;
const COMPACT_HEIGHT = 640;
const COMPACT_BREAKPOINT = 700;
const COMPACT_TWO_COL_WIDTH = 520;
const DOCK_GRID_BREAKPOINT = 560;
const DOCK_ONE_COL_BREAKPOINT = 430;
const DOCK_CARD_WIDTH = 180;

// ── Main App ─────────────────────────────────────────────────────────────────
export function MainApp() {
  const [pinned, setPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [files, setFiles] = useState<CaptureFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"thumbnail" | "list">("thumbnail");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CaptureFile | null>(null);
  const [status, setStatus] = useState("Ready.");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [dockMode, setDockMode] = useState(false);
  const [dockColumns, setDockColumns] = useState<1 | 2>(2);
  const [showDockMenu, setShowDockMenu] = useState(false);
  const settings = loadSettings();
  const galleryMode = settings.galleryMode || "all";
  const isCompact = dockMode || windowWidth <= COMPACT_BREAKPOINT;
  const useDockGrid = dockMode || windowWidth <= DOCK_GRID_BREAKPOINT;
  const dockGridColumns = dockMode ? dockColumns : (windowWidth <= DOCK_ONE_COL_BREAKPOINT ? 1 : 2);
  const missingSaveLocation = settings.saveTarget === "windows"
    ? !settings.windowsSavePath
    : (!settings.distro || !settings.savePath);

  const syncSettingsCache = useCallback(async () => {
    const s = loadSettings();
    await invoke("set_settings_cache", {
      settings: {
        save_target: s.saveTarget,
        distro: s.distro,
        save_path: s.savePath,
        windows_save_path: s.windowsSavePath,
        clipboard_mode: s.clipboardMode,
      },
    }).catch(() => {});
  }, []);

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
        const visible = galleryMode === "focus" ? names.slice(0, 1) : names;
        setFiles(visible.map(name => ({
          name,
          path: joinWindowsPath(settings.windowsSavePath, name),
        })));
        setStatus(
          galleryMode === "focus"
            ? `Focus mode · Windows:${settings.windowsSavePath}`
            : `${names.length} capture${names.length !== 1 ? "s" : ""} · Windows:${settings.windowsSavePath}`
        );
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
        const visible = galleryMode === "focus" ? names.slice(0, 1) : names;
        setFiles(visible.map(name => ({
          name,
          path: `${settings.savePath}/${name}`,
        })));
        setStatus(
          galleryMode === "focus"
            ? `Focus mode · ${settings.distro}:${settings.savePath}`
            : `${names.length} capture${names.length !== 1 ? "s" : ""} · ${settings.distro}:${settings.savePath}`
        );
      }
    } catch (err) {
      setStatus("Error loading captures: " + err);
    } finally {
      setLoading(false);
    }
  }, [settings.saveTarget, settings.distro, settings.savePath, settings.windowsSavePath, galleryMode, reloadNonce]);

  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { syncSettingsCache(); }, [syncSettingsCache]);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.setMinSize(new LogicalSize(COMPACT_WIDTH, COMPACT_HEIGHT)).catch(() => {});
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Toasts from backend (e.g. missing save folder when user triggers Capture via hotkey/menu).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("app-toast", (e) => {
        const msg = String(e.payload || "");
        if (!msg) return;
        setToast({ id: Date.now(), message: msg });
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Auto-dismiss toast quickly (UX: don't leave it stuck on screen).
  useEffect(() => {
    if (!toast) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    };
  }, [toast?.id]);

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
    setShowDockMenu(false);
    // Hide the main window immediately so the user doesn't see the UI while capture is starting.
    // The backend will also hide it again defensively before grabbing the screenshot.
    await invoke("hide_main_window").catch(() => {});
    await new Promise<void>(r => setTimeout(r, 30));
    await invoke("show_overlay").catch(console.error);
  };

  const handlePin = async () => {
    const next = !pinned;
    setPinned(next);
    await invoke("set_always_on_top", { value: next }).catch(console.error);
  };

  const handleHide = async () => {
    await invoke("hide_main_window_user").catch(console.error);
  };

  const handleDockRight = async (columns: 1 | 2 = dockColumns) => {
    setDockColumns(columns);
    setDockMode(true);
    const result = await invoke<DockResult>("toggle_dock_main_right", { dockColumns: columns }).catch(err => {
      console.error(err);
      setStatus("Dock right failed: " + err);
      return null;
    });
    if (!result) {
      setDockMode(false);
      return;
    }
    setPinned(result.alwaysOnTop);
    setDockMode(result.docked);
    setShowDockMenu(false);
    if (result.docked) setWindowWidth(columns === 1 ? COMPACT_WIDTH : COMPACT_TWO_COL_WIDTH);
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
      const ok = await invoke("set_clipboard_files", { paths }).then(() => true).catch(() => false);
      if (!ok) {
        await invoke("set_clipboard_text", { text: paths.join("\n") }).catch(async () => {
          await writeText(paths.join("\n")).catch(console.error);
        });
      }
      setStatus(`Copied ${paths.length} file(s) to clipboard.`);
      return;
    }
    // WSL: copy UNC paths so Windows apps can access the files.
    const uncPaths = paths.map(p => `\\\\wsl.localhost\\${settings.distro}${p.replace(/\//g, "\\")}`);
    const ok = await invoke("set_clipboard_files", { paths: uncPaths }).then(() => true).catch(() => false);
    if (!ok) {
      await invoke("set_clipboard_text", { text: uncPaths.join("\n") }).catch(async () => {
        await writeText(uncPaths.join("\n")).catch(console.error);
      });
    }
    setStatus(`Copied ${uncPaths.length} file(s) to clipboard.`);
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
    syncSettingsCache();
    // Drop thumbnails/list immediately; the next render will re-load based on updated settings.
    setFiles([]);
    setSelected(new Set());
    setLastSelected(null);
    setPreview(null);
    setStatus("Settings updated.");
    setReloadNonce(n => n + 1);
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
      <div style={{ ...S.toolbar, gap: isCompact ? 4 : 6, padding: isCompact ? "8px 10px" : "8px 12px" }}>
        {!dockMode && (
          <div style={S.logo}>
          <Camera style={{ width: 16, height: 16, color: "#bae6fd" }} />
          </div>
        )}
        {!isCompact && <span style={S.logoText}>Capture Pro <span style={{ color: "#60a5fa" }}>v2</span></span>}

        {!isCompact && <div style={S.toolbarSep} />}

        <Btn icon={<Settings size={14} />} label="Settings" onClick={() => setShowSettings(true)} compact={isCompact} />
        <Btn icon={<Camera size={14} />} label="Capture" onClick={handleCapture} primary compact={isCompact} />
        <Btn
          icon={pinned ? <Pin size={14} /> : <PinOff size={14} />}
          label={pinned ? "Pinned" : "Pin"}
          onClick={handlePin}
          active={pinned}
          compact={isCompact}
        />
        {dockMode ? (
          <Btn icon={<ChevronsRight size={14} />} label="Undock" onClick={() => handleDockRight(dockColumns)} compact={isCompact} active />
        ) : (
          <div style={{ position: "relative", display: "flex", flexShrink: 0 }}>
            <Btn icon={<ChevronsRight size={14} />} label={`Dock ${dockColumns}`} onClick={() => handleDockRight(dockColumns)} compact={isCompact} />
            <button
              style={{
                ...S.iconBtn,
                width: isCompact ? 36 : 32,
                height: isCompact ? 36 : 32,
                marginLeft: -1,
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                ...(showDockMenu
                  ? { background: "#eff6ff", borderColor: "#93c5fd", color: "#2563eb", outline: "none", boxShadow: "none" }
                  : { background: "#f8fafc", borderColor: "#cbd5e1", color: "#64748b", outline: "none", boxShadow: "none" }),
              }}
              onClick={() => setShowDockMenu(v => !v)}
              tabIndex={-1}
              data-no-focus-ring="true"
              onPointerDown={(e) => e.preventDefault()}
              title="Choose dock layout"
            >
              <ChevronDown size={13} />
            </button>
            {showDockMenu && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 10px 30px rgba(15,23,42,0.14)", padding: 4, minWidth: 118 }}>
                <button style={{ ...S.menuItem, ...(dockColumns === 1 ? S.menuItemActive : {}) }} onClick={() => { setDockColumns(1); setShowDockMenu(false); }}>
                  <PanelTop size={14} /> Dock 1
                </button>
                <button style={{ ...S.menuItem, ...(dockColumns === 2 ? S.menuItemActive : {}) }} onClick={() => { setDockColumns(2); setShowDockMenu(false); }}>
                  <LayoutGrid size={14} /> Dock 2
                </button>
              </div>
            )}
          </div>
        )}
        <Btn icon={<EyeOff size={14} />} label="Hide" onClick={handleHide} compact={isCompact} />

        <div style={{ flex: 1 }} />

        <div style={S.hotkey}>⌨ Ctrl+Shift+Z</div>
      </div>

      {/* ── Gallery Toolbar ──────────────────────────────────────────────── */}
      <div style={{ ...S.galleryBar, gap: isCompact ? 4 : 6, padding: isCompact ? "6px 10px" : "6px 12px" }}>
        {!isCompact && <span style={S.galleryLabel}>Captures</span>}
        {galleryMode !== "focus" && (
          <IconBtn
            icon={allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            onClick={handleSelectAll}
            title={allSelected ? "Deselect all" : "Select all"}
          />
        )}

        {!isCompact && <div style={S.toolbarSep} />}

        <Btn icon={<Copy size={13} />} label="Paths" onClick={handleCopyPaths} small disabled={files.length === 0} compact={isCompact} />
        <Btn icon={<ImageIcon size={13} />} label="Files (Ctrl+C)" onClick={handleCopyFiles} small disabled={files.length === 0} compact={isCompact} />

        {!isCompact && <div style={S.toolbarSep} />}
        <IconBtn
          icon={<Target size={14} />}
          title={galleryMode === "focus" ? "Exit Focus mode" : "Focus mode (latest only)"}
          activeStyle={galleryMode === "focus"
            ? { background: "#eff6ff", borderColor: "#93c5fd", color: "#2563eb", outline: "none", boxShadow: "none" }
            : { background: "#f8fafc", borderColor: "#cbd5e1", color: "#64748b", outline: "none", boxShadow: "none" }}
          onClick={() => {
            const next = galleryMode === "focus" ? "all" : "focus";
            saveSettings({ galleryMode: next });
            // Drop thumbnails immediately to free RAM when entering focus mode.
            setFiles([]);
            setSelected(new Set());
            setLastSelected(null);
            setPreview(null);
            setStatus(next === "focus" ? "Focus mode enabled (latest only)." : "Focus mode disabled.");
            setReloadNonce(n => n + 1);
          }}
        />

        <div style={{ flex: 1 }} />

        {someSelected && galleryMode !== "focus" && (
          <Btn icon={<Trash2 size={13} />} label={`Delete (${selected.size})`} onClick={handleDelete} small danger compact={isCompact} />
        )}
        {galleryMode !== "focus" && (
          <IconBtn
            icon={viewMode === "thumbnail" ? <List size={14} /> : <LayoutGrid size={14} />}
            onClick={() => setViewMode(v => v === "thumbnail" ? "list" : "thumbnail")}
            title="Toggle view"
          />
        )}
        <IconBtn
          icon={<RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />}
          onClick={loadFiles}
          title="Refresh"
        />
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
        ) : galleryMode === "focus" ? (
          <FocusView
            file={files[0]}
            settings={settings}
            compact={isCompact}
            onLoadThumb={loadThumb}
            onPreview={() => setPreview(files[0])}
            onDelete={async () => {
              const f = files[0];
              if (!f) return;
              try {
                await (settings.saveTarget === "windows"
                  ? invoke("delete_local_file", { path: f.path })
                  : invoke("delete_wsl_file", { distro: settings.distro, path: f.path })
                );
                setFiles([]);
                setSelected(new Set());
                setPreview(null);
                setStatus("Deleted 1 file.");
                // Refresh list to show next latest (still single-item).
                loadFiles();
              } catch (err) {
                setStatus("Delete failed: " + err);
              }
            }}
          />
        ) : viewMode === "thumbnail" ? (
          <ThumbnailGrid
            files={files}
            compact={useDockGrid}
            dockGridColumns={dockGridColumns}
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
            onBandSelect={(next, last) => {
              setSelected(next);
              if (last) setLastSelected(last);
            }}
          />
        )}
      </div>

      {/* ── Status Bar ──────────────────────────────────────────────────── */}
      <div style={{ ...S.statusBar, minHeight: isCompact ? 22 : 28, padding: isCompact ? "4px 10px" : "5px 14px" }}>
        {!isCompact && <span style={{ color: "#64748b", fontSize: 11 }}>{status}</span>}
        {!isCompact && someSelected && (
          <span style={{ marginLeft: "auto", color: "#3b82f6", fontSize: 11, fontWeight: 600 }}>
            {selected.size} selected
          </span>
        )}
      </div>

      {/* ── Preview Modal ─────────────────────────────────────────────── */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 14,
            right: 14,
            zIndex: 99999,
            background: "#dc2626",
            color: "white",
            padding: "10px 14px",
            borderRadius: 12,
            fontSize: 12,
            maxWidth: 520,
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            cursor: "pointer",
            overflow: "hidden",
          }}
          onClick={() => setToast(null)}
        >
          {toast.message}
          <div style={{ height: 3, background: "rgba(255,255,255,0.28)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
            <div
              key={toast.id}
              style={{
                height: "100%",
                width: "100%",
                background: "rgba(255,255,255,0.95)",
                transformOrigin: "left center",
                animation: "toastShrink 2s linear forwards",
              }}
            />
          </div>
        </div>
      )}

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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes toastShrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }

        /* Prevent native text highlight (blue selection) during drag/rubber-band. */
        * { -webkit-user-select: none; user-select: none; }
        input, textarea { -webkit-user-select: text; user-select: text; }
        button { transition: transform 90ms ease, filter 90ms ease, box-shadow 140ms ease, background-color 140ms ease; }
        button:active { transform: translateY(1px) scale(0.98); filter: brightness(0.96); }
      `}</style>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ThumbnailGrid({ files, compact, dockGridColumns, selected, onItemClick, onLoadThumb, onBandSelect }: {
  files: CaptureFile[];
  compact: boolean;
  dockGridColumns: 1 | 2;
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
      style={{ position: "relative", display: "grid", gridTemplateColumns: compact ? (dockGridColumns === 1 ? `${DOCK_CARD_WIDTH}px` : "repeat(2, minmax(0, 1fr))") : "repeat(auto-fill, minmax(150px, 1fr))", gap: compact ? 8 : 10, padding: compact ? 10 : 14, width: "100%", minHeight: "100%", alignContent: "start", justifyContent: compact && dockGridColumns === 1 ? "center" : "start", boxSizing: "border-box" }}
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
            <div style={{ padding: "6px 8px", fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "none" as any, WebkitUserSelect: "none" as any }}>
              {f.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FocusView({ file, settings, compact, onLoadThumb, onPreview, onDelete }: {
  file: CaptureFile;
  settings: AppSettings;
  compact: boolean;
  onLoadThumb: (f: CaptureFile) => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    if (file && !file.thumbnail) onLoadThumb(file);
  }, [file.path, file.thumbnail, onLoadThumb]);

  const subtitle = settings.saveTarget === "windows"
    ? file.path
    : `${settings.distro}:${file.path}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 980, width: "100%", margin: "0 auto", padding: compact ? "10px 10px 12px" : "14px 18px 18px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
          {!compact && <div style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onPreview}
            style={compact ? { width: 34, height: 34, borderRadius: 10, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155" } : { padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#334155" }}
            title="Open preview"
          >
            {compact ? <ImageIcon size={15} /> : "Preview"}
          </button>
          <button
            onClick={onDelete}
            style={compact ? { width: 34, height: 34, borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#b91c1c" } : { padding: "8px 12px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}
            title="Delete latest capture"
          >
            {compact ? <Trash2 size={15} /> : "Delete"}
          </button>
        </div>
      </div>

      <div
        onClick={onPreview}
        style={{
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          background: "white",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
          overflow: "hidden",
          cursor: "pointer",
        }}
        title="Click to preview"
      >
        <div style={{ height: "min(62vh, 640px)", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {file.thumbnail ? (
            <img src={file.thumbnail} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#94a3b8" }}>
              <RefreshCw size={22} style={{ animation: "spin 1s linear infinite" }} />
              <div style={{ fontSize: 12 }}>Loading…</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListView({ files, selected, onItemClick, onBandSelect }: {
  files: CaptureFile[];
  selected: Set<string>;
  onItemClick: (f: CaptureFile, e: React.MouseEvent) => void;
  onBandSelect: (next: Set<string>, lastSelected: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const bandPendingRef = useRef(false);
  const bandActiveRef = useRef(false);
  const bandStartRef = useRef<{ x: number; y: number } | null>(null);
  const bandBaseRef = useRef<Set<string>>(new Set());

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
      if (!bandPendingRef.current) return;
      const start = bandStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      if (!bandActiveRef.current) {
        // Threshold so normal click doesn't clear selection.
        if (dist < 4) return;
        bandActiveRef.current = true;
        setBand({ x1: start.x, y1: start.y, x2: e.clientX, y2: e.clientY });
        updateBandSelection(start.x, start.y, e.clientX, e.clientY);
        return;
      }

      setBand({ x1: start.x, y1: start.y, x2: e.clientX, y2: e.clientY });
      updateBandSelection(start.x, start.y, e.clientX, e.clientY);
    };

    const onUp = () => {
      if (!bandPendingRef.current) return;
      bandPendingRef.current = false;
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

    // Disable native text selection (blue highlight) so rubber-band works.
    e.preventDefault();

    bandPendingRef.current = true;
    bandActiveRef.current = false;
    bandBaseRef.current = (e.ctrlKey || e.metaKey) ? new Set(selected) : new Set();
    bandStartRef.current = { x: e.clientX, y: e.clientY };

    // If user starts drag on a row, it should still behave like Windows selection,
    // so we don't immediately change selection until the drag passes threshold.
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 4, position: "relative", userSelect: "none" as any, WebkitUserSelect: "none" as any, minHeight: "100%", boxSizing: "border-box" }}
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
            data-capture-path={f.path}
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
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "none" as any, WebkitUserSelect: "none" as any }}>{f.name}</span>
            <ChevronRight size={12} style={{ color: "#cbd5e1" }} />
          </div>
        );
      })}
    </div>
  );
}

function Btn({ icon, label, onClick, primary, active, small, danger, disabled, compact }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  primary?: boolean; active?: boolean; small?: boolean; danger?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const primaryBg = "linear-gradient(135deg, #3b82f6, #2563eb)";
  const primaryFg = "#bfdbfe";
  const h = compact ? 36 : 32;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        display: "flex", alignItems: "center", gap: small ? 5 : 6,
        padding: compact ? 0 : (small ? "0 10px" : "0 12px"),
        borderRadius: label.startsWith("Dock ") && !compact ? "8px 0 0 8px" : 8,
        border: primary ? "1px solid #2563eb" : danger ? "1px solid #fecaca" : active ? "1px solid #93c5fd" : "1px solid #cbd5e1",
        background: primary ? primaryBg : danger ? "#fef2f2" : active ? "#eff6ff" : "#f8fafc",
        color: primary ? primaryFg : danger ? "#dc2626" : active ? "#2563eb" : "#374151",
        fontSize: small ? 12 : 13, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        boxShadow: primary ? "0 2px 10px rgba(37,99,235,0.35)" : "none",
        transition: "all 0.12s ease",
        whiteSpace: "nowrap",
        height: h,
        width: compact ? (small ? 32 : 36) : undefined,
        // keep height consistent even for small buttons
        minHeight: h,
        justifyContent: "center",
        flexShrink: 0,
        outline: "none",
      }}
    >
      {icon}
      {!compact && label}
    </button>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
function IconBtn({ icon, title, onClick, activeStyle }: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  activeStyle?: React.CSSProperties;
}) {
  return (
    <button
      style={{ ...S.iconBtn, ...(activeStyle || {}) }}
      onClick={(e) => {
        // Deterministically avoid the persistent focus outline some WebView2 builds draw on click.
        queueMicrotask(() => (e.currentTarget as HTMLButtonElement).blur());
        onClick();
      }}
      title={title}
      tabIndex={-1}
      data-no-focus-ring="true"
      // Prevent mouse focus ring / border changes after click.
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).blur();
      }}
      onPointerUp={(e) => (e.currentTarget as HTMLButtonElement).blur()}
    >
      {icon}
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100vh", background: "#f8fafc", fontFamily: "system-ui, sans-serif", overflow: "hidden" },
  toolbar: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "white", borderBottom: "1px solid #e8edf3", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  logo: { width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  logoText: { fontSize: 14, fontWeight: 700, color: "#1e293b", marginRight: 4 },
  toolbarSep: { width: 1, height: 20, background: "#e8edf3", margin: "0 2px" },
  hotkey: { display: "none", fontSize: 11, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "4px 8px", border: "1px solid #e2e8f0" },
  galleryBar: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#fafbfc", borderBottom: "1px solid #e8edf3" },
  galleryLabel: { fontSize: 12, fontWeight: 600, color: "#374151", marginRight: 2 },
  iconBtn: { width: 32, height: 32, borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", flexShrink: 0, transition: "all 0.12s ease", outline: "none", boxShadow: "none" },
  galleryArea: { flex: 1, overflowY: "auto" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40 },
  statusBar: { display: "flex", alignItems: "center", padding: "5px 14px", background: "white", borderTop: "1px solid #e8edf3", minHeight: 28 },
  modalBg: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  previewBox: { background: "white", borderRadius: 16, padding: 20, maxWidth: "80vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "auto" },
  closeBtn: { width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" },
  menuItem: { width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "white", color: "#334155", borderRadius: 6, padding: "7px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  menuItemActive: { background: "#eff6ff", color: "#2563eb" },
};
