import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MainApp } from "./components/main-app";
import { CaptureOverlay } from "./components/capture-overlay";
import "./App.css";
import { ErrorBoundary } from "./error-boundary";

function useWindowLabel() {
  const [label] = useState(() => {
    try { return getCurrentWindow().label; } catch { return "main"; }
  });
  return label;
}

function App() {
  const windowLabel = useWindowLabel();
  return (
    <ErrorBoundary>
      {windowLabel === "overlay" ? <CaptureOverlay /> : <MainApp />}
    </ErrorBoundary>
  );
}

export default App;
