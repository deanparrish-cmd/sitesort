import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register the PWA service worker (installability + app-shell caching) and make
// updates reach installed PWAs promptly: when a new SW takes control, reload once
// so the fresh build is loaded — installed users are never stranded on old code.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Don't reload on the very first install (no previous controller) — only when
    // an updated SW replaces an existing one.
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => { reg.update?.().catch(() => {}); })
      .catch(() => { /* non-fatal */ });
  });
}
