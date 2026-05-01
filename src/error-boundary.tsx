import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // Keep at least something in console for release troubleshooting.
    // eslint-disable-next-line no-console
    console.error("[CapturePro] UI crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message =
      this.state.error instanceof Error
        ? this.state.error.stack || this.state.error.message
        : String(this.state.error);

    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "#0b1220",
          color: "white",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>UI crashed</div>
        <div
          style={{
            maxWidth: 900,
            width: "100%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            overflow: "auto",
            maxHeight: "55vh",
          }}
        >
          {message}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.08)",
            color: "white",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

