import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { applyTheme, savedTheme } from "./theme";

applyTheme(savedTheme());

// Offline: a worker keeps the app on this device so it opens with no signal.
// Not inside a claude.ai artifact, which serves the app itself.
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.claude) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
