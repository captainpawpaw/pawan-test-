const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _internal } = require('../lib/viera');

const { encrypt, decrypt, pairingKeys, sessionKeys, xmlText } = _internal;

// A fake Viera TV implementing the TV side of the protocol.
function startMockTv({ encrypted }) {
  const tv = { keys: [], volume: 12, muted: false, pin: '4321', challenge: null, encKey: null, appId: null, sessionId: null, apps: [] };

  const soapReply = (action, inner) =>
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:x">${inner}</u:${action}Response></s:Body></s:Envelope>`;
  const fault = (res, code) => {
    res.writeHead(500);
    res.end(`<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>Error ${code}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`);
  };

  function runCommand(action, body) {
    if (action === 'X_SendKey') {
      tv.keys.push(xmlText(body, 'X_KeyEvent'));
      return '';
    }
    if (action === 'X_LaunchApp') {
      tv.apps.push(xmlText(body, 'X_LaunchKeyword'));
      return '';
    }
    if (action === 'X_GetAppList') return "<X_AppList>vc_app'product_id=0010000200000001'0010000200000001'Netflix'0'http://x/n.png'vc_app'product_id=0070000200180001'0070000200180001'YouTube'0'http://x/y.png'</X_AppList>";
    throw new Error('unknown ' + action);
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/nrc/sdd_0.xml') {
        res.end(`<scpd><actionList><action><name>X_SendKey</name></action>${encrypted ? '<action><name>X_GetEncryptSessionId</name></action>' : ''}</actionList></scpd>`);
        return;
      }
      const action = /#(\w+)"/.exec(req.headers.soapaction)[1];
      const reply = (inner) => res.end(soapReply(action, inner));

      if (req.url === '/dmr/control_0') {
        if (action === 'GetVolume') return reply(`<CurrentVolume>${tv.volume}</CurrentVolume>`);
        if (action === 'SetVolume') return (tv.volume = Number(xmlText(body, 'DesiredVolume'))), reply('');
        if (action === 'GetMute') return reply(`<CurrentMute>${tv.muted ? 1 : 0}</CurrentMute>`);
        if (action === 'SetMute') return (tv.muted = xmlText(body, 'DesiredMute') === '1'), reply('');
      }

      if (!encrypted) return reply(runCommand(action, body));

      if (action === 'X_DisplayPinCode') {
        tv.challenge = crypto.randomBytes(16);
        return reply(`<X_ChallengeKey>${tv.challenge.toString('base64')}</X_ChallengeKey>`);
      }
      if (action === 'X_RequestAuth') {
        const k = pairingKeys(tv.challenge);
        const inner = decrypt(xmlText(body, 'X_AuthInfo'), k.key, k.hmacKey, k.iv);
        if (xmlText(inner, 'X_PinCode') !== tv.pin) return fault(res, 600);
        tv.appId = 'APPID' + crypto.randomBytes(4).toString('hex');
        tv.encKey = crypto.randomBytes(16).toString('base64');
        return reply(`<X_AuthResult>${encrypt(`<X_ApplicationId>${tv.appId}</X_ApplicationId><X_Keyword>${tv.encKey}</X_Keyword>`, k.key, k.hmacKey, k.iv)}</X_AuthResult>`);
      }
      if (action === 'X_GetEncryptSessionId') {
        if (xmlText(body, 'X_ApplicationId') !== tv.appId) return fault(res, 600);
        const k = sessionKeys(tv.encKey);
        assert.equal(xmlText(decrypt(xmlText(body, 'X_EncInfo'), k.key, k.hmacKey, k.iv), 'X_ApplicationId'), tv.appId);
        tv.sessionId = String(Math.floor(Math.random() * 1e6));
        return reply(`<X_EncResult>${encrypt(`<X_SessionId>${tv.sessionId}</X_SessionId>`, k.key, k.hmacKey, k.iv)}</X_EncResult>`);
      }
      if (action === 'X_EncryptedCommand') {
        const k = sessionKeys(tv.encKey);
        const inner = decrypt(xmlText(body, 'X_EncInfo'), k.key, k.hmacKey, k.iv);
        if (xmlText(inner, 'X_SessionId') !== tv.sessionId) return fault(res, 401);
        const original = /<X_OriginalCommand><u:(\w+)[^>]*>([\s\S]*)<\/u:\1><\/X_OriginalCommand>/.exec(inner);
        const out = runCommand(original[1], original[2]);
        return reply(`<X_EncResult>${encrypt(soapReply(original[1], out), k.key, k.hmacKey, k.iv)}</X_EncResult>`);
      }
      // Plain NRC commands are refused on an encrypted TV.
      return fault(res, 401);
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ tv, server, port: server.address().port })));
}

module.exports = { startMockTv };
