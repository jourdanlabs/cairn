// scripts/brain-ingest.mjs: secrets are masked before anything reaches the brain (and
// look-alikes survive), a Claude session keeps one note across runs (rewritten in place
// when it grows, never duplicated), and a run leaves no temp files. Runs the real script
// against a throwaway HOME and BRAIN_DIR; synthetic values only, generated per run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'brain-ingest.mjs');
const run = (env, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};
const rnd = (n, a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') =>
  Array.from({ length: n }, () => a[Math.floor(Math.random() * a.length)]).join('');
const b64 = (n) => rnd(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');

test('--scrub masks known secret shapes, leaves look-alikes alone, and is idempotent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'brain-scrub-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'brain', 't');
  mkdirSync(dir, { recursive: true });

  // name → [note text, substrings that must not survive]
  const pos = {};
  const whole = (k, s, wrap = (x) => x) => { pos[k] = [wrap(s), [s]]; };
  whole('sk', `sk-ant-api03-${rnd(40)}`, (s) => `key ${s} here`);
  whole('github', `ghp_${rnd(36)}`);
  whole('aws', `AKIA${rnd(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ234567')}`);
  whole('google', `AIza${rnd(35)}`);
  whole('fireworks', `fw_${rnd(24)}`);
  whole('xai', `xai-${rnd(50)}`);
  whole('stripe', `sk_live_${rnd(24)}`);
  whole('resend', `re_${rnd(32)}`);
  whole('resend_segmented', `re_${rnd(8)}_${rnd(24)}`);
  whole('fly', `fm2a_${b64(60)}`, (s) => `token: FlyV1 ${s}`);
  whole('fly_v2', `fm2_${b64(60)}`);
  whole('slack_xoxc', `xoxc-${rnd(12, '0123456789')}-${rnd(12, '0123456789')}-${rnd(40)}`);
  whole('slack_xoxd', `xoxd-${rnd(20)}%2F${rnd(20)}%2B${rnd(20)}%3D%3D`, (s) => `cookie d=${s}; Path=/`);
  whole('jwt', `eyJ${rnd(20)}.eyJ${rnd(30)}.${rnd(25)}`);
  const pw = `npg_${rnd(12)}`; pos.url_password = [`postgres://owner:${pw}@ep-x.neon.tech/db`, [pw.slice(4)]];
  const ev = `${rnd(24)}9`; pos.env_assign = [`GITHUB_TOKEN=${ev}`, [ev.slice(4)]];
  const br = `${rnd(30)}7`; pos.bearer = [`Authorization: Bearer ${br}`, [br.slice(4)]];
  const [p1, p2] = [b64(64), b64(64)];
  pos.pem_multiline = [`-----BEGIN OPENSSH PRIVATE KEY-----\n${p1}\n${p2}\n-----END OPENSSH PRIVATE KEY-----`, [p1, p2]];
  const [q1, q2] = [b64(64), b64(64)];
  pos.pem_json = [`{"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----\\n${q1}\\n${q2}\\n-----END PRIVATE KEY-----\\n", "client_email": "x@y.iam.gserviceaccount.com"}`, [q1, q2]];
  const [e1, e2] = [b64(70), b64(40)];
  pos.pem_no_end = [`**You:** here it is -----BEGIN RSA PRIVATE KEY-----\n${e1}\n${e2}\n\n**Bulma:** please never paste keys`, [e1, e2]];

  const neg = {
    process_env: 'const GITHUB_TOKEN = process.env.GITHUB_TOKEN;',
    placeholder: 'export OPENAI_API_KEY=<your key>',
    max_tokens: 'MAX_TOKENS=16000',
    sha256: 'sha256 c5f2a1b9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1',
    word_boundary: 'risk-adjusted-return-on-capital-model-for-banks-and-lenders',
    prose_bearer: 'the Bearer token pattern is standard everywhere in OAuth flows',
    shell_ref: 'DB_PASSWORD=$DB_PASSWORD',
    plain_urls: 'https://github.com/lelandsequel/cairn and git@github.com:lelandsequel/cairn.git',
    environ: 'API_KEY=os.environ.get("KEY")',
    public_key: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----',
    key_path: 'SIGNET_PRIVATE_KEY_PATH=/Users/x/keys/signet.pem',
    re_identifier: 'def re_normalize_whitespace(text): return text',
    slack_prose: 'Slack bot tokens start with xoxb- and user tokens with xoxp-',
    fly_prose: 'Fly tokens look like FlyV1 fm2_ followed by a long string',
    pem_prose_span: '**You:** what does -----BEGIN PRIVATE KEY----- mean at the top\n\n**Claude:** It opens the block, and the file closes with -----END PRIVATE KEY----- at the bottom.',
  };
  for (const [k, [text]] of Object.entries(pos)) writeFileSync(join(dir, `${k}.md`), text);
  for (const [k, text] of Object.entries(neg)) writeFileSync(join(dir, `${k}.md`), text);

  run({ BRAIN_DIR: join(root, 'brain') }, '--scrub');
  for (const [k, [text, secrets]] of Object.entries(pos)) {
    const out = readFileSync(join(dir, `${k}.md`), 'utf8');
    assert.ok(out.includes('[masked'), `${k}: not masked`);
    for (const s of secrets) assert.ok(!out.includes(s), `${k}: secret survived`);
    assert.ok(out.length < text.length + 40, `${k}: output grew`);
  }
  assert.match(readFileSync(join(dir, 'pem_json.md'), 'utf8'), /client_email/);
  assert.match(readFileSync(join(dir, 'pem_no_end.md'), 'utf8'), /please never paste keys/);
  for (const [k, text] of Object.entries(neg)) assert.equal(readFileSync(join(dir, `${k}.md`), 'utf8'), text, `${k}: changed`);

  assert.match(run({ BRAIN_DIR: join(root, 'brain') }, '--scrub'), /0 of \d+ carry secrets/);
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('a Claude session keeps one note across runs and is rewritten in place when it grows', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'brain-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, BRAIN_DIR: join(home, 'brain') };
  const proj = join(home, '.claude', 'projects', 'p');
  mkdirSync(proj, { recursive: true });
  const session = join(proj, '0a1b2c3d-session.jsonl');
  const line = (role, text, ts) => JSON.stringify({ timestamp: ts, message: { role, content: text } }) + '\n';
  writeFileSync(session, line('user', 'plan the gate', '2026-10-02T10:00:00Z') + line('assistant', 'first answer', '2026-10-02T10:01:00Z'));
  const notes = () => readdirSync(join(home, 'brain', 'claude')).filter((n) => n.endsWith('.md'));

  run(env);
  assert.equal(notes().length, 1);
  const [name] = notes();
  assert.match(readFileSync(join(home, 'brain', 'claude', name), 'utf8'), /first answer/);

  // the session grows after its note was written; the note is rewritten under the same name
  appendFileSync(session, line('assistant', 'second answer', '2026-10-02T11:00:00Z'));
  const hourAgo = new Date(Date.now() - 3600e3), halfHourAgo = new Date(Date.now() - 1800e3);
  utimesSync(join(home, 'brain', 'claude', name), hourAgo, hourAgo);
  utimesSync(session, halfHourAgo, halfHourAgo);
  assert.match(run(env), /claude: {2}1 transcripts written/);
  assert.deepEqual(notes(), [name]);
  assert.match(readFileSync(join(home, 'brain', 'claude', name), 'utf8'), /second answer/);

  // nothing changed: nothing rewritten, no temp files left behind
  assert.match(run(env), /claude: {2}0 transcripts written, 1 up to date/);
  assert.deepEqual(readdirSync(join(home, 'brain', 'claude')).filter((n) => n.endsWith('.tmp')), []);
});
