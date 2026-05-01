import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "@/lib/store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder, ChevronRight, Home, RefreshCw, Check, ChevronUp } from "lucide-react";

interface WslDistro {
  name: string;
  is_default: boolean;
}

interface WslBridgeProps {
  onSaved?: (distro: string, path: string) => void;
}

export function WslBridge({ onSaved }: WslBridgeProps) {
  const settings = loadSettings();
  const [distros, setDistros] = useState<WslDistro[]>([]);
  const [selectedDistro, setSelectedDistro] = useState<string>(settings.distro || "");
  const [currentPath, setCurrentPath] = useState<string>(settings.savePath || "/");
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchDistros = async () => {
    try {
      const list = await invoke<WslDistro[]>("list_wsl_distros");
      setDistros(list);
      if (list.length > 0 && !selectedDistro) {
        const defaultDistro = list.find((d) => d.is_default) || list[0];
        const name = defaultDistro.name as string;
        setSelectedDistro(name);
        saveSettings({ distro: name });
      }
    } catch (err) {
      setError("Failed to fetch WSL distros: " + err);
    }
  };

  const fetchDirectories = async (distro: string, path: string) => {
    setLoading(true);
    setDirectories([]); // Clear immediately to prevent stale clicks
    setError(null);
    try {
      const list = await invoke<string[]>("list_wsl_directories", { distro, path });
      setDirectories(list);
    } catch (err) {
      setError("Failed to fetch directories: " + err);
    } finally {
      setLoading(false);
    }
  };

  const goHome = async () => {
    if (!selectedDistro) return;
    try {
      const home = await invoke<string>("get_wsl_home_directory", { distro: selectedDistro });
      setCurrentPath(home);
    } catch (err) {
      setError("Failed to get home directory: " + err);
    }
  };

  useEffect(() => { fetchDistros(); }, []);
  useEffect(() => {
    if (selectedDistro) fetchDirectories(selectedDistro, currentPath);
  }, [selectedDistro, currentPath]);

  const handleDirClick = (dir: string) => {
    const newPath = currentPath === "/" ? `/${dir}` : `${currentPath}/${dir}`;
    setCurrentPath(newPath);
  };

  const goUp = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter((p) => p !== "");
    parts.pop();
    setCurrentPath("/" + parts.join("/") || "/");
  };

  const handleSelectFolder = () => {
    saveSettings({ distro: selectedDistro, savePath: currentPath });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved?.(selectedDistro, currentPath);
  };

  const handleDistroChange = (val: string) => {
    setSelectedDistro(val);
    setCurrentPath("/");
    saveSettings({ distro: val });
  };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div style={{
      background: "white",
      borderRadius: 18,
      border: "1px solid #e8edf3",
      boxShadow: "0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px",
        background: "linear-gradient(135deg, #f8faff 0%, #f1f5fb 100%)",
        borderBottom: "1px solid #e8edf3",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ padding: 7, background: "linear-gradient(135deg, #3b82f6, #2563eb)", borderRadius: 9, boxShadow: "0 2px 8px rgba(37,99,235,0.3)" }}>
            <Folder style={{ width: 15, height: 15, color: "white" }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>WSL Save Location</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>Choose where captures are saved</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={fetchDistros}
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
            title="Refresh"
          >
            <RefreshCw style={{ width: 14, height: 14 }} />
          </button>
          <button
            onClick={goHome}
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
            title="Go to home"
          >
            <Home style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Distro selector */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 8 }}>
            Distribution
          </div>
          <Select value={selectedDistro} onValueChange={handleDistroChange}>
            <SelectTrigger style={{ width: "100%", height: 40, fontSize: 13, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fafbfc" }}>
              <SelectValue placeholder="Select a WSL distro..." />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              {distros.map((d) => (
                <SelectItem key={d.name} value={d.name} style={{ fontSize: 13 }}>
                  {d.name} {d.is_default ? " ✓ Default" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Breadcrumb */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 8 }}>
            Path
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 14px",
            background: "#f8fafc",
            borderRadius: 10,
            border: "1px solid #e8edf3",
            gap: 4,
            flexWrap: "wrap",
          }}>
            <span
              onClick={() => setCurrentPath("/")}
              style={{ color: breadcrumbs.length === 0 ? "#1e293b" : "#3b82f6", fontWeight: 600, cursor: "pointer", fontSize: 13, padding: "1px 4px", borderRadius: 4 }}
            >
              /
            </span>
            {breadcrumbs.map((part, i) => {
              const pathTo = "/" + breadcrumbs.slice(0, i + 1).join("/");
              const isLast = i === breadcrumbs.length - 1;
              return (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ChevronRight style={{ width: 12, height: 12, color: "#cbd5e1" }} />
                  <span
                    onClick={() => !isLast && setCurrentPath(pathTo)}
                    style={{
                      color: isLast ? "#1e293b" : "#3b82f6",
                      fontWeight: isLast ? 700 : 500,
                      cursor: isLast ? "default" : "pointer",
                      fontSize: 13,
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: isLast ? "#f1f5f9" : "transparent",
                    }}
                  >
                    {part}
                  </span>
                </span>
              );
            })}
            {currentPath !== "/" && (
              <button
                onClick={goUp}
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", background: "white", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: "3px 8px" }}
              >
                <ChevronUp style={{ width: 11, height: 11 }} /> Up
              </button>
            )}
          </div>
        </div>

        {/* Directory grid */}
        <div style={{
          minHeight: 220,
          maxHeight: 300,
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #f1f5f9",
          background: "#fafbfc",
          padding: 12,
        }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, gap: 10, color: "#94a3b8" }}>
              <div style={{ width: 28, height: 28, border: "2px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12 }}>Scanning directories...</span>
            </div>
          ) : directories.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, gap: 8, color: "#94a3b8" }}>
              <div style={{ width: 48, height: 48, background: "#f1f5f9", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}>No subdirectories</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>This folder has no subfolders — you can still select it</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {directories.map((dir) => (
                <button
                  key={dir}
                  onClick={() => handleDirClick(dir)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px",
                    background: "white",
                    border: "1px solid #e8edf3",
                    borderRadius: 10,
                    fontSize: 13, color: "#334155",
                    cursor: "pointer", textAlign: "left",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    transition: "all 0.12s ease",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = "#93c5fd";
                    el.style.background = "#eff6ff";
                    el.style.boxShadow = "0 2px 8px rgba(59,130,246,0.12)";
                    el.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = "#e8edf3";
                    el.style.background = "white";
                    el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                    el.style.transform = "translateY(0)";
                  }}
                >
                  <Folder style={{ width: 15, height: 15, color: "#60a5fa", flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{dir}</span>
                  <ChevronRight style={{ width: 13, height: 13, color: "#cbd5e1", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 16px",
          background: "linear-gradient(135deg, #f8faff, #f1f5fb)",
          borderRadius: 12,
          border: "1px solid #e8edf3",
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>
              Selected Target
            </div>
            <div style={{ fontSize: 13, color: "#475569", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedDistro
                ? <><span style={{ color: "#2563eb", fontWeight: 600 }}>{selectedDistro}</span><span style={{ color: "#cbd5e1", margin: "0 5px" }}>›</span><span style={{ fontFamily: "monospace", fontSize: 12 }}>{currentPath}</span></>
                : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>No distro selected</span>
              }
            </div>
          </div>
          <button
            onClick={handleSelectFolder}
            style={{
              padding: "10px 24px",
              borderRadius: 10,
              background: saved
                ? "linear-gradient(135deg, #16a34a, #15803d)"
                : "linear-gradient(135deg, #3b82f6, #2563eb)",
              color: "white", border: "none",
              fontWeight: 600, fontSize: 13,
              cursor: "pointer",
              boxShadow: saved
                ? "0 4px 14px rgba(22,163,74,0.35)"
                : "0 4px 14px rgba(37,99,235,0.35)",
              transition: "all 0.2s ease",
              display: "flex", alignItems: "center", gap: 7,
              transform: saved ? "scale(0.98)" : "scale(1)",
            }}
          >
            {saved ? <><Check style={{ width: 14, height: 14 }} /> Saved!</> : "Select Folder"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
