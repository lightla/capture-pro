import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "@/lib/store";

interface Rect { x: number; y: number; width: number; height: number; }

type DragMode = "none" | "select" | "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "resize-n" | "resize-s" | "resize-w" | "resize-e";

const HANDLE_SIZE = 10;
const HANDLE_HIT = 14;

const V1_BLUE = "rgba(69,163,255,0.98)"; // NRGBA{69,163,255,255}
const V1_BLUE_SOLID = "rgba(69,163,255,1)";

declare global {
  interface Window {
    __captureProPendingBackground?: string;
    __captureProPendingError?: string;
    __captureProSetBackground?: (background: string) => void;
    __captureProSetError?: (error: string) => void;
  }
}

export function CaptureOverlay() {
  const [background, setBackground] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [saving, setSaving] = useState(false);
  const [cursor, setCursor] = useState<React.CSSProperties["cursor"]>("crosshair");
  const cursorRef = useRef<React.CSSProperties["cursor"]>("crosshair");

  const dragMode = useRef<DragMode>("none");
  const startMouse = useRef({ x: 0, y: 0 });
  const startRect = useRef<Rect | null>(null);
  const captureToken = useRef(0);

  const resetOverlay = useCallback(() => {
    captureToken.current++;
    setBackground(null);
    setSelection(null);
    setSaving(false);
    setError(null);
  }, []);

  useEffect(() => {
    let unlistenHide: any;
    window.__captureProSetBackground = (background) => {
      captureToken.current++;
      window.__captureProPendingBackground = undefined;
      window.__captureProPendingError = undefined;
      setBackground(background);
      setSelection(null);
      setSaving(false);
      setError(null);
    };
    window.__captureProSetError = (message) => {
      resetOverlay();
      window.__captureProPendingError = undefined;
      setError("Screenshot failed: " + message);
    };

    if (window.__captureProPendingBackground) {
      window.__captureProSetBackground(window.__captureProPendingBackground);
    } else if (window.__captureProPendingError) {
      window.__captureProSetError(window.__captureProPendingError);
    }

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenHide = await listen("overlay-hide", resetOverlay);
    };
    setup();

    return () => {
      if (window.__captureProSetBackground) delete window.__captureProSetBackground;
      if (window.__captureProSetError) delete window.__captureProSetError;
      if (unlistenHide) unlistenHide();
    };
  }, [resetOverlay]);



  const doCapture = useCallback(async (sel: Rect) => {
    if (saving || !sel || sel.width < 4 || sel.height < 4 || !background) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      const w = Math.max(1, Math.round(sel.width));
      const h = Math.max(1, Math.round(sel.height));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = rej;
        img.src = background;
      });
      const scaleX = img.naturalWidth / window.innerWidth;
      const scaleY = img.naturalHeight / window.innerHeight;
      ctx.drawImage(
        img,
        sel.x * scaleX, sel.y * scaleY, w * scaleX, h * scaleY,
        0, 0, w, h
      );
      const dataUrl = canvas.toDataURL("image/png");

      const settings = loadSettings();
      const distro = settings.distro || "Ubuntu-24.04";
      const savePath = settings.savePath || "/home";
      const path = `${savePath}/Snip_${Date.now()}.png`;
      await invoke("write_wsl_base64_file", { distro, path, dataUrl });

      setSaving(false);
      invoke("close_overlay");
    } catch (err) {
      const message = "Save failed: " + String(err);
      setError(message);
      setSaving(false);
    }
  }, [saving, background]);


  // Keyboard: Esc cancel, Enter capture, F1 fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("close_overlay");
      if (e.key === "Enter" && selection) doCapture(selection);
      if (e.key === "F1") {
        // Full screen capture
        const w = window.innerWidth;
        const h = window.innerHeight;
        doCapture({ x: 0, y: 0, width: w, height: h });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, doCapture]);

  // Hit-test handle areas
  const getHitZone = (pos: { x: number; y: number }, sel: Rect): DragMode => {
    const { x, y, width, height } = sel;
    const r = x + width, b = y + height;
    const near = (a: number, b: number) => Math.abs(a - b) <= HANDLE_HIT;
    if (near(pos.x, x) && near(pos.y, y)) return "resize-nw";
    if (near(pos.x, r) && near(pos.y, y)) return "resize-ne";
    if (near(pos.x, x) && near(pos.y, b)) return "resize-sw";
    if (near(pos.x, r) && near(pos.y, b)) return "resize-se";
    if (near(pos.y, y) && pos.x > x && pos.x < r) return "resize-n";
    if (near(pos.y, b) && pos.x > x && pos.x < r) return "resize-s";
    if (near(pos.x, x) && pos.y > y && pos.y < b) return "resize-w";
    if (near(pos.x, r) && pos.y > y && pos.y < b) return "resize-e";
    if (pos.x > x && pos.x < r && pos.y > y && pos.y < b) return "move";
    return "select";
  };

  const cursorForMode = (mode: DragMode): React.CSSProperties["cursor"] => {
    switch (mode) {
      case "move":
        return "move";
      case "resize-n":
      case "resize-s":
        return "ns-resize";
      case "resize-e":
      case "resize-w":
        return "ew-resize";
      case "resize-ne":
      case "resize-sw":
        return "nesw-resize";
      case "resize-nw":
      case "resize-se":
        return "nwse-resize";
      case "select":
      case "none":
      default:
        return "crosshair";
    }
  };

  const setCursorIfChanged = (next: React.CSSProperties["cursor"]) => {
    if (cursorRef.current === next) return;
    cursorRef.current = next;
    setCursor(next);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (saving) return; // Only block if CURRENTLY saving
    e.preventDefault();
    const pos = { x: e.clientX, y: e.clientY };
    const zone = selection ? getHitZone(pos, selection) : "select";
    dragMode.current = zone;
    setCursorIfChanged(cursorForMode(zone));
    startMouse.current = pos;
    startRect.current = selection ? { ...selection } : null;
    if (zone === "select") {
      setSelection({ x: pos.x, y: pos.y, width: 0, height: 0 });
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const pos = { x: e.clientX, y: e.clientY };

    const hoverZone = selection ? getHitZone(pos, selection) : "select";
    const effectiveZone = dragMode.current === "none" ? hoverZone : dragMode.current;
    setCursorIfChanged(cursorForMode(effectiveZone));
    if (dragMode.current === "none") return;
    const dx = pos.x - startMouse.current.x;
    const dy = pos.y - startMouse.current.y;
    const orig = startRect.current;

    if (dragMode.current === "select") {
      setSelection({
        x: Math.min(pos.x, startMouse.current.x),
        y: Math.min(pos.y, startMouse.current.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    } else if (dragMode.current === "move" && orig) {
      setSelection({ ...orig, x: orig.x + dx, y: orig.y + dy });
    } else if (orig) {
      // Resize
      let { x, y, width, height } = orig;
      if (dragMode.current.includes("e")) width = Math.max(8, width + dx);
      if (dragMode.current.includes("s")) height = Math.max(8, height + dy);
      if (dragMode.current.includes("w")) { x = orig.x + dx; width = Math.max(8, orig.width - dx); }
      if (dragMode.current.includes("n")) { y = orig.y + dy; height = Math.max(8, orig.height - dy); }
      setSelection({ x, y, width, height });
    }
  };

  const onMouseUp = () => {
    dragMode.current = "none";
    setCursorIfChanged("crosshair");
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!selection || saving) return;
    const pos = { x: e.clientX, y: e.clientY };
    const zone = getHitZone(pos, selection);
    // Double click inside selection → capture
    if (zone === "move") doCapture(selection);
  };

  // ── Error State ──
  if (error) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "white", gap: 20 }}>
      <div style={{ fontSize: 18, fontWeight: "bold" }}>Capture Failed</div>
      <div style={{ background: "rgba(255,0,0,0.2)", padding: "12px 24px", borderRadius: 8, border: "1px solid red" }}>{error}</div>
      <button 
        onClick={() => invoke("show_overlay")}
        style={{ background: "white", color: "black", border: "none", padding: "8px 24px", borderRadius: 6, cursor: "pointer" }}
      >
        Try Again
      </button>
      <button 
        onClick={() => invoke("close_overlay")}
        style={{ background: "transparent", color: "white", border: "1px solid white", padding: "8px 24px", borderRadius: 6, cursor: "pointer" }}
      >
        Close
      </button>
    </div>
  );

  // ── Waiting for the hidden capture to finish ──
  if (!background) return (
    <div style={{ position: "fixed", inset: 0, background: "transparent" }} />
  );

  // (errors shown inline as toast)

  // ── Saved flash (overlay on top of screenshot, not fullscreen) ──
  // handled inline below

  const sel = selection;

  return (
    <div
      style={{ position: "fixed", inset: 0, overflow: "hidden", userSelect: "none", cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
      onMouseLeave={() => setCursorIfChanged("crosshair")}
    >
      {/* Screenshot background */}
      <img src={background!} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", display: "block" }} />

      {/* Dim mask — 4 rectangles around the selection so selected area stays clear */}
      {sel && sel.width > 0 ? <>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: sel.y, background: "rgba(12,14,24,0.66)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: sel.y + sel.height, left: 0, right: 0, bottom: 0, background: "rgba(12,14,24,0.66)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: sel.y, left: 0, width: sel.x, height: sel.height, background: "rgba(12,14,24,0.66)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: sel.y, left: sel.x + sel.width, right: 0, height: sel.height, background: "rgba(12,14,24,0.66)", pointerEvents: "none" }} />
      </> : (
        <div style={{ position: "absolute", inset: 0, background: "rgba(12,14,24,0.66)", pointerEvents: "none" }} />
      )}

      {/* Selection border + handles */}
      {sel && sel.width > 0 && sel.height > 0 && (
        <div style={{ position: "absolute", left: sel.x, top: sel.y, width: sel.width, height: sel.height, border: `2px solid ${V1_BLUE}`, boxShadow: "0 0 0 1px rgba(0,0,0,0.3)", pointerEvents: "none" }}>
          {/* Size badge */}
          <div style={{ position: "absolute", top: -28, left: 0, background: "rgba(24,28,39,0.92)", color: "white", fontSize: 11, padding: "3px 8px", borderRadius: 5, fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {Math.round(sel.width)} × {Math.round(sel.height)}
          </div>
          {/* 8 handles */}
          {[
            { top: -HANDLE_SIZE/2, left: -HANDLE_SIZE/2 },
            { top: -HANDLE_SIZE/2, left: sel.width/2 - HANDLE_SIZE/2 },
            { top: -HANDLE_SIZE/2, right: -HANDLE_SIZE/2 },
            { top: sel.height/2 - HANDLE_SIZE/2, left: -HANDLE_SIZE/2 },
            { top: sel.height/2 - HANDLE_SIZE/2, right: -HANDLE_SIZE/2 },
            { bottom: -HANDLE_SIZE/2, left: -HANDLE_SIZE/2 },
            { bottom: -HANDLE_SIZE/2, left: sel.width/2 - HANDLE_SIZE/2 },
            { bottom: -HANDLE_SIZE/2, right: -HANDLE_SIZE/2 },
          ].map((style, i) => (
            <div key={i} style={{ position: "absolute", width: HANDLE_SIZE, height: HANDLE_SIZE, background: V1_BLUE_SOLID, boxShadow: "0 0 0 1px rgba(255,255,255,0.9)", borderRadius: 2, ...style }} />
          ))}
        </div>
      )}

      {/* Hint bar */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "rgba(24,28,39,0.88)", backdropFilter: "blur(8px)", padding: "8px 20px", borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 16, pointerEvents: "none" }}>
        {[["F1", "Full screen"], ["F2", "Window"], ["F3", "Freeform"], ["Enter", "Capture", true], ["Esc", "Cancel", false, true]].map(([key, label, primary, danger]) => (
          <span key={String(key)} style={{ fontSize: 11, color: danger ? "#f87171" : primary ? "white" : "rgba(255,255,255,0.55)" }}>
            <span style={{ fontWeight: 600 }}>{key}</span> {label}
          </span>
        ))}
        {sel && sel.width > 4 && <span style={{ fontSize: 11, color: "#60a5fa" }}>· Double-click inside to capture</span>}
      </div>

      {error && (
        <div style={{ position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)", background: "#dc2626", color: "white", padding: "10px 20px", borderRadius: 10, fontSize: 12, maxWidth: 400, textAlign: "center", cursor: "pointer" }}
          onClick={() => setError(null)}>
        ⚠️ {error} (click to dismiss)
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
