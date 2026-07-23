// Law-edition tests: profiles are vocabulary + defaults + card kinds — never engine
// changes — and the OCR fallback stays honest (flagged, never faked, when tools are absent).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, getProfile, kindGuidance } from '../lib/profiles.mjs';
import { extractionPrompt } from '../lib/consolidate.mjs';
import { ocrAvailable, resetOcrDetection } from '../lib/ocr.mjs';

test('getProfile: known names resolve, unknown falls back to personal', () => {
  assert.equal(getProfile('law').name, 'law');
  assert.equal(getProfile('LAW').name, 'law');
  assert.equal(getProfile('bank').name, 'bank');
  assert.equal(getProfile('nope').name, 'personal');
  assert.equal(getProfile('').name, 'personal');
});

test('law profile: stricter default, pin-cite vocabulary, witness/issue/matter kinds', () => {
  const law = getProfile('law');
  assert.ok(law.prefs.strictness > PROFILES.personal.prefs.strictness || law.prefs.strictness === 0.7);
  assert.equal(law.terms.receipt, 'pin cite');
  assert.equal(law.terms.vault, 'matter file');
  for (const k of ['witness', 'issue', 'matter']) assert.ok(law.cardKinds[k], `missing card kind: ${k}`);
});

test('kindGuidance: requested kind wins, unknown falls back to profile default', () => {
  const law = getProfile('law');
  assert.ok(kindGuidance(law, 'witness').includes('WITNESS'));
  assert.ok(kindGuidance(law, 'WITNESS').includes('WITNESS'));
  assert.ok(kindGuidance(law, 'bogus').includes('dated events'));
  assert.ok(kindGuidance(getProfile('personal'), 'witness').includes('identity facts'));
});

test('witness guidance forbids credibility characterization', () => {
  assert.ok(kindGuidance(getProfile('law'), 'witness').includes('Never characterize credibility'));
});

test('extractionPrompt carries the kind guidance into the model instructions', () => {
  const msgs = extractionPrompt('Daniel Hargrove', [{ note: 'depo.md', text: 'testimony text' }], kindGuidance(getProfile('law'), 'witness'));
  const user = msgs.find((m) => m.role === 'user').content;
  assert.ok(user.includes('WITNESS card'));
  assert.ok(user.includes('inconsistencies between statements'));
});

test('ocrAvailable is a boolean and caches; absence is honest, not fatal', async () => {
  resetOcrDetection();
  const a = await ocrAvailable();
  assert.equal(typeof a, 'boolean');
  assert.equal(await ocrAvailable(), a); // cached, stable
});

test('data/civic/energy profiles: shape, strictness, and the never-merge soul', () => {
  for (const [name, s] of [['data', 0.65], ['civic', 0.75], ['energy', 0.75]]) {
    const p = getProfile(name);
    assert.equal(p.name, name);
    assert.equal(p.prefs.strictness, s);
    assert.ok(p.terms.receipt, `${name} must rename receipt in-profession`);
    assert.ok(Object.keys(p.cardKinds).length >= 3);
  }
  assert.ok(kindGuidance(getProfile('data'), 'metric').includes('never merge or average'));
  assert.ok(kindGuidance(getProfile('energy'), 'moc').includes('OPEN — never assume it was done'));
  assert.ok(kindGuidance(getProfile('civic'), 'official').includes('Never characterize performance'));
});
