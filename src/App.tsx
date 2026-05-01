import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MainApp } from "./components/main-app";
import { CaptureOverlay } from "./components/capture-overlay";
import "./App.css";

function useWindowLabel() {
  const [label] = useState(() => {
    try { return getCurrentWindow().label; } catch { return "main"; }
  });
  return label;
}

function App() {
  const windowLabel = useWindowLabel();
  if (windowLabel === "overlay") return <CaptureOverlay />;
  return <MainApp />;
}

export default App;
