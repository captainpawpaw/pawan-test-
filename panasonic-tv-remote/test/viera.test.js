const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { VieraTV, _internal } = require('../lib/viera');
const { startMockTv } = require('./mock-tv');

const { encrypt, decrypt, pairingKeys, sessionKeys, xmlText } = _internal;

test('encrypt/decrypt round-trip, including block-aligned payloads', () => {
  const k = sessionKeys(crypto.randomBytes(16).toString('base64'));
  for (const msg of ['<a>1</a>', '<X_SessionId>1234</X_SessionId>', '<b>' + 'x'.repeat(57) + '</b>']) {
    assert.equal(decrypt(encrypt(msg, k.key, k.hmacKey, k.iv), k.key, k.hmacKey, k.iv), msg);
  }
});

test('unencrypted TV: keys, volume, mute, apps', async (t) => {
  const { tv, server, port } = await startMockTv({ encrypted: false });
  t.after(() => server.close());
  const client = new VieraTV({ host: '127.0.0.1', port });

  assert.equal(await client.detectEncryption(), false);
  await client.sendKey('NRC_VOLUP-ONOFF');
  assert.deepEqual(tv.keys, ['NRC_VOLUP-ONOFF']);
  assert.equal(await client.getVolume(), 12);
  assert.equal(await client.setVolume(140), 100);
  assert.equal(tv.volume, 100);
  await client.setMute(true);
  assert.equal(await client.getMute(), true);
  assert.deepEqual(await client.getApps(), [
    { id: '0010000200000001', name: 'Netflix' },
    { id: '0070000200180001', name: 'YouTube' },
  ]);
  await client.launchApp('0070000200180001');
  assert.deepEqual(tv.apps, ['product_id=0070000200180001']);
  assert.throws(() => client.sendKey('rm -rf'), /Unknown key/);
});

test('encrypted TV: PIN pairing, encrypted commands, session renewal', async (t) => {
  const { tv, server, port } = await startMockTv({ encrypted: true });
  t.after(() => server.close());
  const client = new VieraTV({ host: '127.0.0.1', port });

  await assert.rejects(client.sendKey('NRC_HOME-ONOFF'), { code: 'NOT_PAIRED' });

  await client.requestPin();
  await assert.rejects(client.authorizePin('0000'), { code: 'BAD_PIN' });
  await client.requestPin();
  const creds = await client.authorizePin('4321');
  assert.equal(creds.appId, tv.appId);
  assert.equal(creds.encKey, tv.encKey);

  // A fresh client with saved credentials works without re-pairing.
  const saved = new VieraTV({ host: '127.0.0.1', port, ...creds });
  await saved.sendKey('NRC_HOME-ONOFF');
  await saved.sendKey('NRC_ENTER-ONOFF');
  assert.deepEqual(tv.keys, ['NRC_HOME-ONOFF', 'NRC_ENTER-ONOFF']);

  // TV forgets the session (e.g. after standby): client reconnects transparently.
  tv.sessionId = 'expired';
  await saved.sendKey('NRC_MENU-ONOFF');
  assert.equal(tv.keys.at(-1), 'NRC_MENU-ONOFF');

  assert.equal((await saved.getApps()).length, 2);
});

test('unreachable TV gives a friendly error', async () => {
  const client = new VieraTV({ host: '127.0.0.1', port: 1, timeout: 500 });
  await assert.rejects(client.sendKey('NRC_HOME-ONOFF'), /Cannot reach TV/);
});
