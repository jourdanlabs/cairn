// CAIRN Studio — desktop shell. Boots the local, zero-dependency CAIRN server (the
// SAME server.mjs the CLI/browser use) and loads its UI in a native window. Adds the
// product surface a script doesn't have: a native "Open Vault…" picker that remembers
// the last vault and reindexes live, a real app menu, and a first-run prompt. Electron
// lives ONLY here in desktop/ — the CAIRN core stays zero-dependency.
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const port = Number(process.env.CAIRN_STUDIO_PORT ?? 4611);
const url = `http://127.0.0.1:${port}`;

// From source (`npm start`) the repo is desktop/.. ; a packaged .app falls back to the
// known checkout (a dev-launcher for the operator's machine, like OMNIS KEY's).
const root =
  process.env.CAIRN_ROOT ||
  (app.isPackaged ? path.join(os.homedir(), "projects", "cairn") : path.join(__dirname, ".."));

// ── persisted settings (last vault) ─────────────────────────────────────────────
const configPath = () => path.join(app.getPath("userData"), "cairn-studio.json");
function readConfig() {
  try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  try { mkdirSync(path.dirname(configPath()), { recursive: true }); writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch { /* best effort */ }
  return cfg;
}

let win;
let server;

function startServer(vault) {
  if (process.env.CAIRN_SKIP_SERVER) return;
  // A double-clicked .app gets a bare PATH; launch through a login shell so the user's
  // real node is found, and `exec` so kill() reaches it. HOST stays loopback.
  const sh = process.env.SHELL || "/bin/zsh";
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1" };
  if (vault) env.VAULT_DIR = vault;          // explicit choice overrides .env
  else delete env.VAULT_DIR;                  // no choice → let server.mjs read its .env
  server = spawn(sh, ["-lc", "exec node server.mjs"], { cwd: root, stdio: "inherit", env });
  server.on("error", (e) => console.error(`[cairn] server error: ${e.message}`));
}
function stopServer() { if (server) { try { server.kill("SIGINT"); } catch {} server = null; } }

async function waitForHealth(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${url}/api/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
async function serverStatus() {
  try { return await (await fetch(`${url}/api/status`)).json(); } catch { return null; }
}

// Switch the whole app to a new vault: persist it, restart the server on it, reload UI.
async function useVault(vault) {
  writeConfig({ vault });
  if (win) win.webContents.executeJavaScript(
    `document.getElementById('status') && (document.getElementById('status').textContent='indexing '+${JSON.stringify(path.basename(vault))}+'…')`
  ).catch(() => {});
  stopServer();
  await new Promise((r) => setTimeout(r, 400));
  startServer(vault);
  await waitForHealth();
  if (win) win.loadURL(url);
}

async function openVaultDialog() {
  const res = await dialog.showOpenDialog(win, {
    title: "Choose your knowledge vault",
    message: "Pick the folder CAIRN should index (your notes, policies, or docs).",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this vault",
  });
  if (!res.canceled && res.filePaths[0]) await useVault(res.filePaths[0]);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Vault…", accelerator: "CmdOrCtrl+O", click: openVaultDialog },
        { label: "Reindex Vault", accelerator: "CmdOrCtrl+R", click: async () => { try { await fetch(`${url}/api/reindex`, { method: "POST" }); } catch {} if (win) win.reload(); } },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "CAIRN on GitHub", click: () => shell.openExternal("https://github.com/jourdanlabs/cairn") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 880, minWidth: 940, minHeight: 640,
    backgroundColor: "#ece3d0", // parchment, so first paint matches the archive
    title: "CAIRN Studio",
    titleBarStyle: "default",   // a real, draggable macOS titlebar
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);
  // obsidian:// and external links open in the OS, not inside the app frame.
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
}

app.whenReady().then(async () => {
  buildMenu();
  const saved = readConfig().vault;
  const vault = saved && existsSync(saved) ? saved : null; // remembered vault, if it still exists
  startServer(vault);
  const ready = await waitForHealth();
  if (!ready) console.warn("[cairn] server health timeout — loading anyway");
  createWindow();

  // First-run / no-vault: once the UI has loaded, if the server indexed nothing,
  // ask the operator to pick a vault instead of showing a dev-speak empty state.
  win.webContents.once("did-finish-load", async () => {
    const st = await serverStatus();
    if (st && !st.ready) setTimeout(openVaultDialog, 400);
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { stopServer(); if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => stopServer());
