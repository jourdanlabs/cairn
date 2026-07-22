// Test helpers — build/clean throwaway vaults in the OS tmp dir. Node built-ins only.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

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
