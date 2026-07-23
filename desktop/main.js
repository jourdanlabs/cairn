// CAIRN Studio — desktop shell. Boots the local, zero-dependency CAIRN server (the
// SAME server.mjs the CLI/browser use) and loads its UI in a native window. Adds the
// product surface a script doesn't have: a native "Open Vault…" picker that remembers
// the last vault and reindexes live, a real app menu, and a first-run prompt. Electron
// lives ONLY here in desktop/ — the CAIRN core stays zero-dependency.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const port = Number(process.env.CAIRN_STUDIO_PORT ?? 4611);
const url = `http://127.0.0.1:${port}`;

// From source (`npm start`) the repo is desktop/.. ; a packaged .app falls back to the
// known checkout (a dev-launcher for the operator's machine, like OMNIS KEY's).
// Packaged: the zero-dep core is bundled read-only in the app's Resources. Dev: the repo.
const root =
  process.env.CAIRN_ROOT ||
  (app.isPackaged ? path.join(process.resourcesPath, "cairn-core") : path.join(__dirname, ".."));

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
let MODEL_ENV = {}; // auto-detected local model config (Ollama), passed to the server

// If a local Ollama is running, wire its models into the server so Ask + semantic
// search "just work" — no config. Prefers a fast general chat model; uses any
// *embed* model for semantic search. Silent no-op if Ollama isn't up.
async function detectLocalModel() {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return {};
    const names = ((await r.json()).models || []).map((m) => m.name || m.model).filter(Boolean);
    const embed = names.find((n) => /embed/i.test(n));
    const chat =
      names.find((n) => /gemma4/i.test(n)) ||
      names.find((n) => /gemma3/i.test(n)) ||
      names.find((n) => /qwen3(?!.*coder)/i.test(n)) ||
      names.find((n) => /(gemma|llama|mistral|phi)/i.test(n)) ||
      names.find((n) => !/embed/i.test(n));
    if (!chat) return {};
    console.log(`[cairn] local model: ${chat}${embed ? " + " + embed : ""} (Ollama)`);
    return {
      MODEL_BASE_URL: "http://localhost:11434/v1",
      MODEL_NAME: chat,
      ...(embed ? { MODEL_EMBED: embed, EMBEDDINGS: "on" } : {}),
    };
  } catch { return {}; }
}

function startServer(vault) {
  if (process.env.CAIRN_SKIP_SERVER) return;
  // Run the server with Electron's OWN Node (ELECTRON_RUN_AS_NODE) so no system `node`
  // is required — truly self-contained. State goes to a writable userData dir (the
  // bundled core in Resources is read-only). HOST stays loopback.
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port), HOST: "127.0.0.1",
    CAIRN_STATE_DIR: path.join(app.getPath("userData"), "state"),
    ...MODEL_ENV, // local Ollama, if detected
  };
  if (vault) env.VAULT_DIR = vault;          // explicit choice overrides .env
  else delete env.VAULT_DIR;                  // no choice → let server.mjs read its .env
  server = spawn(process.execPath, [path.join(root, "server.mjs")], { cwd: root, stdio: "inherit", env });
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  win.loadURL(url);
  // obsidian:// and external links open in the OS, not inside the app frame.
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
}

// IPC: the onboarding overlay in the web UI connects a vault through these.
ipcMain.handle("cairn:use-vault", async (_e, p) => { if (p) await useVault(p); return true; });
ipcMain.handle("cairn:pick-folder", async () => { await openVaultDialog(); return true; });

app.whenReady().then(async () => {
  buildMenu();
  MODEL_ENV = await detectLocalModel(); // light up Ask + semantic search if Ollama is running
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
