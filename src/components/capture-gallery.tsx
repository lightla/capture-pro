import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "@/lib/store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Image, RefreshCw, Trash2, Copy, CheckSquare, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CaptureFile {
  name: string;
  path: string;
  thumbnail?: string;
  loading?: boolean;
}

export function CaptureGallery() {
  const [files, setFiles] = useState<CaptureFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<CaptureFile | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"actual" | "fit">("actual");
  const [error, setError] = useState<string | null>(null);

  const settings = loadSettings();

  const joinWindowsPath = (dir: string, name: string) => {
    const d = dir.endsWith("\\") || dir.endsWith("/") ? dir.slice(0, -1) : dir;
    return `${d}\\${name}`;
  };

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (settings.saveTarget === "windows") {
        if (!settings.windowsSavePath) {
          setError("No save location configured. Set it in the Browse tab.");
          setFiles([]);
          return;
        }
        const names = await invoke<string[]>("list_local_image_files", { dir: settings.windowsSavePath });
        setFiles(names.map((name) => ({
          name,
          path: joinWindowsPath(settings.windowsSavePath, name),
        })));
      } else {
        if (!settings.distro || !settings.savePath) {
          setError("No save location configured. Set it in the Browse tab.");
          setFiles([]);
          return;
        }
        const names = await invoke<string[]>("list_wsl_image_files", {
          distro: settings.distro,
          path: settings.savePath,
        });
        setFiles(names.map((name) => ({
          name,
          path: `${settings.savePath}/${name}`,
        })));
      }
      setSelected(new Set());
    } catch (err) {
      setError("Failed to load images: " + err);
    } finally {
      setLoading(false);
    }
  }, [settings.saveTarget, settings.distro, settings.savePath, settings.windowsSavePath]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const loadThumbnail = async (file: CaptureFile) => {
    if (file.thumbnail || file.loading) return;
    setFiles((prev) =>
      prev.map((f) => (f.path === file.path ? { ...f, loading: true } : f))
    );
    try {
      const data = settings.saveTarget === "windows"
        ? await invoke<string>("read_local_image_as_base64", { path: file.path })
        : await invoke<string>("read_wsl_image_as_base64", { distro: settings.distro, path: file.path });
      setFiles((prev) =>
        prev.map((f) => (f.path === file.path ? { ...f, thumbnail: data, loading: false } : f))
      );
    } catch {
      setFiles((prev) =>
        prev.map((f) => (f.path === file.path ? { ...f, loading: false } : f))
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!preview) {
        setPreviewDataUrl(null);
        return;
      }
      setPreviewMode("actual");
      if (preview.thumbnail) {
        setPreviewDataUrl(preview.thumbnail);
        return;
      }
      setPreviewDataUrl(null);
      try {
        const data = await invoke<string>("read_wsl_image_as_base64", {
          distro: settings.distro,
          path: preview.path,
        });
        if (cancelled) return;
        setPreviewDataUrl(data);
      } catch {
        if (cancelled) return;
        setPreviewDataUrl(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [preview, settings.distro]);

  const handleSelect = (file: CaptureFile, e: React.MouseEvent) => {
    const newSet = new Set(selected);

    if (e.shiftKey && lastSelected) {
      // Range selection
      const fileNames = files.map((f) => f.path);
      const lastIdx = fileNames.indexOf(lastSelected);
      const curIdx = fileNames.indexOf(file.path);
      const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
      for (let i = start; i <= end; i++) newSet.add(fileNames[i]);
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle individual
      if (newSet.has(file.path)) newSet.delete(file.path);
      else newSet.add(file.path);
    } else {
      // Single click - show preview only
      setPreview(file);
      if (!file.thumbnail) loadThumbnail(file);
      return;
    }

    setSelected(newSet);
    setLastSelected(file.path);
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const toDelete = Array.from(selected);
    try {
      await Promise.all(
        toDelete.map((path) =>
          settings.saveTarget === "windows"
            ? invoke("delete_local_file", { path })
            : invoke("delete_wsl_file", { distro: settings.distro, path })
        )
      );
      setFiles((prev) => prev.filter((f) => !selected.has(f.path)));
      setSelected(new Set());
    } catch (err) {
      setError("Failed to delete: " + err);
    }
  };

  const copyPaths = async () => {
    const paths = Array.from(selected).join("\n") || files.map((f) => f.path).join("\n");
    await invoke("set_clipboard_text", { text: paths }).catch(async () => {
      await writeText(paths).catch(() => {});
    });
  };

  const selectAll = () => {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.path)));
  };

  const s: Record<string, React.CSSProperties> = {
    wrap: { display: "flex", flexDirection: "column", gap: 12, height: "100%" },
    toolbar: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "white", borderRadius: 12, border: "1px solid #e2e8f0", flexWrap: "wrap" },
    toolbarTitle: { display: "flex", alignItems: "center", gap: 8, flex: 1 },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, overflowY: "auto", maxHeight: 480, padding: 2 },
    card: { borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", cursor: "pointer", transition: "all 0.15s ease", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
    cardSelected: { borderColor: "#3b82f6", boxShadow: "0 0 0 2px rgba(59,130,246,0.2)" },
    imgBox: { width: "100%", aspectRatio: "16/10", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" },
    cardLabel: { padding: "6px 8px", fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "#cbd5e1", gap: 10 },
    previewModal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
    previewBox: { background: "white", borderRadius: 16, padding: 20, maxWidth: "80vw", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  };

  return (
    <div style={s.wrap}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarTitle}>
          <Image style={{ width: 16, height: 16, color: "#2563eb" }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>
            Gallery
          </span>
          <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "2px 8px" }}>
            {files.length} images
          </span>
          {(settings.saveTarget === "windows" ? settings.windowsSavePath : settings.savePath) && (
            <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
              {settings.saveTarget === "windows"
                ? `Windows:${settings.windowsSavePath}`
                : `${settings.distro}:${settings.savePath}`}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="outline" size="sm" onClick={selectAll}>
            {selected.size === files.length && files.length > 0
              ? <CheckSquare style={{ width: 13, height: 13 }} />
              : <Square style={{ width: 13, height: 13 }} />}
            &nbsp;All
          </Button>
          {selected.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={copyPaths}>
                <Copy style={{ width: 13, height: 13 }} />
                &nbsp;Copy {selected.size} path{selected.size > 1 ? "s" : ""}
              </Button>
              <Button variant="destructive" size="sm" onClick={deleteSelected}
                style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                <Trash2 style={{ width: 13, height: 13 }} />
                &nbsp;Delete {selected.size}
              </Button>
            </>
          )}
          <Button variant="outline" size="icon" onClick={loadFiles}>
            <RefreshCw style={{ width: 14, height: 14, animation: loading ? "spin 1s linear infinite" : undefined }} />
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Grid */}
      {files.length === 0 && !loading ? (
        <div style={s.emptyState}>
          <div style={{ fontSize: 40 }}>📷</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#94a3b8" }}>No captures yet</div>
          <div style={{ fontSize: 12 }}>Press Ctrl+Shift+Z to start capturing</div>
        </div>
      ) : (
        <div style={s.grid}>
          {files.map((file) => {
            const isSelected = selected.has(file.path);
            return (
              <div
                key={file.path}
                style={{ ...s.card, ...(isSelected ? s.cardSelected : {}) }}
                onClick={(e) => handleSelect(file, e)}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = "#93c5fd";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0";
                }}
                onMouseOver={() => !file.thumbnail && loadThumbnail(file)}
              >
                <div style={s.imgBox}>
                  {isSelected && (
                    <div style={{ position: "absolute", top: 4, right: 4, zIndex: 2 }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {file.thumbnail ? (
                    <img src={file.thumbnail} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : file.loading ? (
                    <RefreshCw style={{ width: 20, height: 20, color: "#cbd5e1", animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Image style={{ width: 24, height: 24, color: "#e2e8f0" }} />
                  )}
                </div>
                <div style={s.cardLabel}>{file.name}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div style={s.previewModal} onClick={() => setPreview(null)}>
          <div style={s.previewBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>{preview.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => setPreviewMode((m) => (m === "actual" ? "fit" : "actual"))}
                  style={{ background: "white", border: "1px solid #e2e8f0", cursor: "pointer", color: "#334155", fontSize: 11, padding: "6px 10px", borderRadius: 8 }}
                  title={previewMode === "actual" ? "Fit to window" : "Show 1:1 pixels"}
                >
                  {previewMode === "actual" ? "Fit" : "1:1"}
                </button>
                <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
              </div>
            </div>
            {previewDataUrl ? (
              <div
                style={{ borderRadius: 8, border: "1px solid #f1f5f9", background: "#0b1220", overflow: "auto", maxHeight: "70vh" }}
                onDoubleClick={() => setPreviewMode((m) => (m === "actual" ? "fit" : "actual"))}
                title="Double-click to toggle Fit / 1:1"
              >
                <img
                  src={previewDataUrl}
                  alt={preview.name}
                  style={
                    previewMode === "fit"
                      ? { maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", display: "block", margin: "0 auto" }
                      : { maxWidth: "none", maxHeight: "none", display: "block" }
                  }
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#94a3b8" }}>
                <RefreshCw style={{ width: 24, height: 24, animation: "spin 1s linear infinite" }} />
              </div>
            )}
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b", background: "#f8fafc", borderRadius: 8, padding: "8px 12px" }}>
              {settings.saveTarget === "windows" ? preview.path : `${settings.distro}:${preview.path}`}
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
