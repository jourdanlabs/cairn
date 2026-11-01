// lib/model.mjs — MODEL_TEMPERATURE controls the temperature field of the chat request
// body actually sent. Unset must stay byte-for-byte today's request (temperature 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chat } from '../lib/model.mjs';

async function sentBody(temperatureEnv) {
  const saved = { fetch: globalThis.fetch, t: process.env.MODEL_TEMPERATURE, b: process.env.MODEL_BASE_URL, k: process.env.MODEL_API_KEY };
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: ' OK ' } }] }) };
  };
  if (temperatureEnv === undefined) delete process.env.MODEL_TEMPERATURE; else process.env.MODEL_TEMPERATURE = temperatureEnv;
  process.env.MODEL_BASE_URL = 'https://example.invalid/v1';
  process.env.MODEL_API_KEY = 'test';
  try {
    assert.equal(await chat([{ role: 'user', content: 'hi' }], 'm'), 'OK');
    return body;
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [['MODEL_TEMPERATURE', saved.t], ['MODEL_BASE_URL', saved.b], ['MODEL_API_KEY', saved.k]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('unset MODEL_TEMPERATURE sends temperature 0, exactly as before', async () => {
  assert.deepEqual(await sentBody(undefined), { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false, temperature: 0 });
});

test('MODEL_TEMPERATURE=default omits the field entirely', async () => {
  const b = await sentBody('default');
  assert.equal('temperature' in b, false);
  assert.deepEqual(b, { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false });
  assert.equal('temperature' in (await sentBody(' DEFAULT ')), false);
});

test('a number is sent as that number', async () => {
  assert.equal((await sentBody('0.2')).temperature, 0.2);
  assert.equal((await sentBody('1')).temperature, 1);
});

test('garbage falls back to 0, never to the model default', async () => {
  assert.equal((await sentBody('warm')).temperature, 0);
  assert.equal((await sentBody('')).temperature, 0);
});
