// Safe bridge: lets the CAIRN web UI (renderer) ask the desktop shell to connect a
// vault natively, without exposing Node to the page. Present only in the desktop app;
// in a plain browser `window.cairnDesktop` is undefined and the UI falls back to
// instructions. See the onboarding overlay in public/index.html.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cairnDesktop", {
  isDesktop: true,
  useVault: (path) => ipcRenderer.invoke("cairn:use-vault", path), // connect a known folder
  pickFolder: () => ipcRenderer.invoke("cairn:pick-folder"),        // native "Browse…" dialog
});
