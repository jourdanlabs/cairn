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

## Honest note

The scaffold (`main.js`, `package.json`, `build/icon.png`) is complete and mirrors the
working OMNIS KEY desktop setup verbatim; the one step that must run on your machine is
`npm install` (it fetches the Electron binary over the network) and the actual window
launch. Those weren't run in the build session — everything up to them is in place.
