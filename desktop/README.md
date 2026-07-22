# CAIRN Studio (desktop)

The desktop face of CAIRN — a native window over the same local `server.mjs`. Mirrors
the OMNIS KEY desktop shell.

**The CAIRN core stays zero-dependency.** Electron lives only in this `desktop/` folder
with its own `package.json`; the server a bank deploys never sees it. Two faces, one core.

## Run it

```bash
cd desktop
npm install          # downloads Electron (~100 MB) — needs network the first time
npm start            # boots server.mjs on :4611 (loopback) and opens the window
```

Point it at a vault the same way the server does — a `.env` at the repo root, or the
`VAULT_DIR` env var. With no vault the window loads and says "no vault — set VAULT_DIR".

## Package a .app / .dmg

```bash
npm run dist         # electron-builder → dist/CAIRN Studio.dmg  (icon from build/icon.png)
```

## Self-contained

The packaged `.dmg` is **fully self-contained** — it runs on any Mac, no `~/projects/cairn`
checkout required:
- The zero-dependency core (`server.mjs`, `lib/`, `core/`, `connectors/`, `public/`) is
  bundled read-only into the app's `Resources/cairn-core` via `extraResources`.
- The server runs on **Electron's own Node** (`ELECTRON_RUN_AS_NODE`), so no system `node`
  is needed either.
- Writable state (receipt ledger, preferences, access log, uploaded art) lives in the app's
  `userData` dir (`CAIRN_STATE_DIR`), since Resources is read-only.

Point it at a vault via the in-app **Open Vault…** picker (⌘O) or the welcome tour — any folder.
