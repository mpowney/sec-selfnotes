import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { loadConfig, normalizeBasePath } from '../src/config.ts';

test('base path normalisation', () => {
  assert.equal(normalizeBasePath(undefined), '/sync');
  assert.equal(normalizeBasePath('sync/'), '/sync');
  assert.equal(normalizeBasePath('/'), '');
});

test('serves config, health and redirects bare base path', async () => {
  const cfg = loadConfig({ MS_CLIENT_ID: 'abc', PUBLIC_DIR: process.cwd() + '/public' } as any);
  const server = createApp(cfg).listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const conf = await (await fetch(`http://127.0.0.1:${port}/sync/config.json`)).json();
    assert.equal(conf.msClientId, 'abc');
    assert.equal(conf.basePath, '/sync');
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/sync/health`)).json(), { ok: true });
    const r = await fetch(`http://127.0.0.1:${port}/sync`, { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/sync/');
    assert.ok((await fetch(`http://127.0.0.1:${port}/sync/`)).headers.get('content-security-policy'));
  } finally {
    server.close();
  }
});
