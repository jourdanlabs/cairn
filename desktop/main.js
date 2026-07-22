// CAIRN Studio — desktop shell. Boots the local, zero-dependency CAIRN server (the
// SAME server.mjs the CLI/browser use) and loads its UI in a native window. Second
// face; the server is the first. Electron lives ONLY here, in desktop/ — the CAIRN
// core stays zero-dependency so a bank can still deploy the server alone.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");

const port = Number(process.env.CAIRN_STUDIO_PORT ?? 4611); // own port; won't collide with a plain `node server.mjs` on 4600
const url = `http://127.0.0.1:${port}`;

// From source (`npm start`) the repo is desktop/.. ; a packaged .app falls back to the
// known checkout (a dev-launcher for the operator's machine, like OMNIS KEY's).
const root =
  process.env.CAIRN_ROOT ||
  (app.isPackaged ? path.join(os.homedir(), "projects", "cairn") : path.join(__dirname, ".."));

let win;
let server;

function startServer() {
  if (process.env.CAIRN_SKIP_SERVER) return;
  // A double-clicked .app gets a bare PATH; launch through a login shell so the user's
  // real node is found, and `exec` so kill() reaches it. HOST stays loopback (the
  // server already defaults to 127.0.0.1) — the Studio is a local surface.
  const sh = process.env.SHELL || "/bin/zsh";
  server = spawn(sh, ["-lc", "exec node server.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  });
  server.on("error", (err) => console.error(`[cairn] server error: ${err.message}`));
  server.on("exit", (code) => { if (code && code !== 0) console.error(`[cairn] server exited ${code}`); });
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const res = await fetch(`${url}/api/health`); if (res.ok) return true; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ece3d0", // parchment, so first paint matches the archive
    title: "CAIRN Studio",
    titleBarStyle: "default", // a real, draggable macOS titlebar (a frameless one needs a CSS drag region — that's the bug OMNIS KEY hit)
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);
  // obsidian:// links and any external targets open in the OS, not inside the app frame.
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
}

app.whenReady().then(async () => {
  startServer();
  const ready = await waitForHealth();
  if (!ready) console.warn("[cairn] server health timeout — loading anyway");
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (server) server.kill("SIGINT"); if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (server) server.kill("SIGINT"); });
