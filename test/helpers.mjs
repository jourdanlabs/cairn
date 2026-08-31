// Test helpers — build/clean throwaway vaults in the OS tmp dir. Node built-ins only.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// files: { 'rel/path.md': 'content', ... } → returns the vault dir.
export function mkVault(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

export function rmVault(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Backdate a file's mtime by `days` (for stale-note tests).
export function ageFile(dir, rel, days) {
  const t = new Date(Date.now() - days * 86400000);
  utimesSync(join(dir, rel), t, t);
}

/** Boot a real CAIRN server against a throwaway vault. Caller must child.kill(). */
export async function bootServer(extraEnv = {}, files = {
  'note.md': '# Note\n\nThe widget assembly line runs on Tuesdays. Coating thickness was 3.2 mils.\n',
}) {
  const vault = extraEnv.CAIRN_VAULT_DIR || mkVault(files);
  const state = extraEnv.CAIRN_STATE_DIR || mkdtempSync(join(tmpdir(), 'cairn-state-'));
  const port = 5000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1',
      CAIRN_VAULT_DIR: vault, CAIRN_STATE_DIR: state,
      MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_EMBED: '', MODEL_API_KEY: '',
      EMBEDDINGS: 'off', WATCH: 'off',
      ...extraEnv,
      CAIRN_VAULT_DIR: extraEnv.CAIRN_VAULT_DIR || vault,
      CAIRN_STATE_DIR: extraEnv.CAIRN_STATE_DIR || state,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return { child, base, vault, state }; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('server did not boot');
}
