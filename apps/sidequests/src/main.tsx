import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The whole point is that it works on a phone with no signal, so cache the
// shell on first visit. Dev keeps the worker out of the way.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Resolved against the document, so it keeps working when the app is
    // served from a subdirectory rather than a domain root.
    const worker = new URL("sw.js", document.baseURI).href;
    navigator.serviceWorker.register(worker).catch(() => {
      // No offline cache — the app still runs, it just needs the network once.
    });
  });
}
