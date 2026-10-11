// Client for the Panasonic Viera network remote API (UPnP/SOAP on port 55000).
//
// Older Viera sets accept plain SOAP commands. Most 2019+ models (and some
// 2018 ones) require pairing: the TV shows a PIN, we exchange it for an
// application ID + key, and every remote command is then AES-128-CBC
// encrypted and HMAC-SHA256 signed inside an X_EncryptedCommand wrapper.

const http = require('node:http');
const crypto = require('node:crypto');

const DEFAULT_PORT = 55000;
const URL_NRC = '/nrc/control_0';
const URL_DMR = '/dmr/control_0';
const URN_NRC = 'panasonic-com:service:p00NetworkControl:1';
const URN_RENDER = 'schemas-upnp-org:service:RenderingControl:1';
const APP_NAME = 'Panasonic TV Remote';

// From libtvconnect.so; mixed with the challenge key to derive the pairing HMAC key.
const HMAC_KEY_MASK = Buffer.from([
  0x15, 0xc9, 0x5a, 0xc2, 0xb0, 0x8a, 0xa7, 0xeb, 0x4e, 0x22, 0x8f, 0x81, 0x1e, 0x34, 0x1d, 0x04,
  0xfa, 0x4e, 0x7b, 0x72, 0x37, 0x8e, 0x20, 0xec, 0x07, 0x6f, 0x8e, 0x67, 0x3c, 0x26, 0x10, 0xd9,
]);

class VieraError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Returns the text content of the first <tag> (namespace prefix ignored).
function xmlText(xml, tag) {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  return m ? xmlUnescape(m[1].trim()) : null;
}

function encrypt(data, key, hmacKey, iv) {
  // 12 random bytes + big-endian payload length, then the payload, zero-padded to the block size.
  const body = Buffer.from(data, 'utf8');
  const header = Buffer.concat([crypto.randomBytes(12), Buffer.alloc(4)]);
  header.writeUInt32BE(body.length, 12);
  let payload = Buffer.concat([header, body]);
  payload = Buffer.concat([payload, Buffer.alloc(16 - (payload.length % 16))]);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const sig = crypto.createHmac('sha256', hmacKey).update(ciphertext).digest();
  return Buffer.concat([ciphertext, sig]).toString('base64');
}

function decrypt(b64, key, hmacKey, iv) {
  let raw = Buffer.from(b64, 'base64');
  // Strip the trailing HMAC-SHA256 signature when present.
  if (raw.length >= 48) {
    const body = raw.subarray(0, raw.length - 32);
    const sig = crypto.createHmac('sha256', hmacKey).update(body).digest();
    if (sig.equals(raw.subarray(raw.length - 32))) raw = body;
  }
  raw = raw.subarray(0, raw.length - (raw.length % 16));
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(raw), decipher.final()]);
  const len = plain.readUInt32BE(12);
  const body = plain.subarray(16);
  // The TV doesn't always fill in the length field, so fall back to trimming after the last tag.
  if (len > 0 && len <= body.length) return body.subarray(0, len).toString('utf8');
  const text = body.toString('utf8');
  return text.slice(0, text.lastIndexOf('>') + 1);
}

function pairingKeys(challenge) {
  const iv = challenge;
  const key = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 4) {
    key[i] = ~iv[i + 3] & 0xff;
    key[i + 1] = ~iv[i + 2] & 0xff;
    key[i + 2] = ~iv[i + 1] & 0xff;
    key[i + 3] = ~iv[i] & 0xff;
  }
  const hmacKey = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 4) {
    hmacKey[i] = HMAC_KEY_MASK[i] ^ iv[(i + 2) & 0xf];
    hmacKey[i + 1] = HMAC_KEY_MASK[i + 1] ^ iv[(i + 3) & 0xf];
    hmacKey[i + 2] = HMAC_KEY_MASK[i + 2] ^ iv[i & 0xf];
    hmacKey[i + 3] = HMAC_KEY_MASK[i + 3] ^ iv[(i + 1) & 0xf];
  }
  return { key, hmacKey, iv };
}

function sessionKeys(encKeyB64) {
  const iv = Buffer.from(encKeyB64, 'base64');
  const key = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 4) {
    key[i] = iv[i + 2];
    key[i + 1] = iv[i + 3];
    key[i + 2] = iv[i];
    key[i + 3] = iv[i + 1];
  }
  return { key, hmacKey: Buffer.concat([iv, iv]), iv };
}

function wrapAction(prefix, action, urn, params) {
  return `<${prefix}:${action} xmlns:${prefix}="urn:${urn}">${params}</${prefix}:${action}>`;
}

class VieraTV {
  constructor({ host, port = DEFAULT_PORT, appId, encKey, timeout = 4000 } = {}) {
    if (!host) throw new Error('host is required');
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.appId = appId || null;
    this.encKey = encKey || null;
    this.encrypted = null; // unknown until detectEncryption() runs
    this.session = null;
    this.challenge = null;
  }

  get paired() {
    return Boolean(this.appId && this.encKey);
  }

  // --- low-level HTTP/SOAP ---------------------------------------------------

  httpRequest(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: this.host, port: this.port, method, path, timeout: this.timeout, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('timeout', () => req.destroy(new VieraError(`TV at ${this.host} did not respond (is it on and on the same network?)`, { code: 'TIMEOUT' })));
      req.on('error', (err) =>
        reject(err instanceof VieraError ? err : new VieraError(`Cannot reach TV at ${this.host}: ${err.message}`, { code: err.code })),
      );
      if (body) req.write(body);
      req.end();
    });
  }

  async rawSoap(path, urn, action, params) {
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      `<s:Body>${wrapAction('u', action, urn, params)}</s:Body></s:Envelope>`;
    const res = await this.httpRequest('POST', path, body, {
      'Content-Type': 'text/xml; charset="utf-8"',
      'Content-Length': Buffer.byteLength(body),
      SOAPACTION: `"urn:${urn}#${action}"`,
    });
    if (res.status !== 200) {
      const code = xmlText(res.body, 'errorCode');
      const desc = xmlText(res.body, 'errorDescription');
      throw new VieraError(`TV rejected ${action}: ${desc || `HTTP ${res.status}`}${code ? ` (UPnP ${code})` : ''}`, {
        code: code || `HTTP_${res.status}`,
        status: res.status,
      });
    }
    return res.body;
  }

  // NRC (remote control) commands go through the encrypted channel when the TV needs it.
  async nrc(action, params = '') {
    if (this.encrypted === null) await this.detectEncryption();
    if (!this.encrypted) return this.rawSoap(URL_NRC, URN_NRC, action, params);
    if (!this.paired) throw new VieraError('This TV requires pairing. Pair it from the app first.', { code: 'NOT_PAIRED' });

    try {
      return await this.encryptedNrc(action, params);
    } catch (err) {
      // Sessions expire; if the TV rejected the command, get a fresh session and retry once.
      if (err.status && err.code !== 'NOT_PAIRED' && this.session) {
        this.session = null;
        return this.encryptedNrc(action, params);
      }
      throw err;
    }
  }

  async encryptedNrc(action, params) {
    if (!this.session) await this.openSession();
    const s = this.session;
    const inner =
      `<X_SessionId>${s.id}</X_SessionId>` +
      `<X_SequenceNumber>${String(s.seq).padStart(8, '0')}</X_SequenceNumber>` +
      `<X_OriginalCommand>${wrapAction('u', action, URN_NRC, params)}</X_OriginalCommand>`;
    s.seq += 1;
    const encInfo = encrypt(inner, s.keys.key, s.keys.hmacKey, s.keys.iv);
    const res = await this.rawSoap(
      URL_NRC,
      URN_NRC,
      'X_EncryptedCommand',
      `<X_ApplicationId>${this.appId}</X_ApplicationId><X_EncInfo>${encInfo}</X_EncInfo>`,
    );
    const result = xmlText(res, 'X_EncResult');
    return result ? decrypt(result, s.keys.key, s.keys.hmacKey, s.keys.iv) : res;
  }

  async openSession() {
    const keys = sessionKeys(this.encKey);
    const encInfo = encrypt(`<X_ApplicationId>${this.appId}</X_ApplicationId>`, keys.key, keys.hmacKey, keys.iv);
    let res;
    try {
      res = await this.rawSoap(
        URL_NRC,
        URN_NRC,
        'X_GetEncryptSessionId',
        `<X_ApplicationId>${this.appId}</X_ApplicationId><X_EncInfo>${encInfo}</X_EncInfo>`,
      );
    } catch (err) {
      if (err.status === 500) throw new VieraError('The TV no longer accepts this pairing. Pair it again.', { code: 'NOT_PAIRED' });
      throw err;
    }
    const decrypted = decrypt(xmlText(res, 'X_EncResult'), keys.key, keys.hmacKey, keys.iv);
    const id = xmlText(decrypted, 'X_SessionId');
    if (!id) throw new VieraError('TV did not return a session id', { code: 'BAD_SESSION' });
    this.session = { id, seq: 1, keys };
  }

  // --- encryption detection & pairing -----------------------------------------

  async detectEncryption() {
    const res = await this.httpRequest('GET', '/nrc/sdd_0.xml');
    if (res.status !== 200) throw new VieraError(`TV at ${this.host} is not a Viera remote endpoint (HTTP ${res.status})`, { code: 'NOT_VIERA' });
    this.encrypted = res.body.includes('X_GetEncryptSessionId');
    return this.encrypted;
  }

  // Step 1: ask the TV to show a PIN on screen.
  async requestPin() {
    const res = await this.rawSoap(URL_NRC, URN_NRC, 'X_DisplayPinCode', `<X_DeviceName>${xmlEscape(APP_NAME)}</X_DeviceName>`);
    const challenge = xmlText(res, 'X_ChallengeKey');
    if (!challenge) throw new VieraError('TV did not return a challenge key', { code: 'BAD_CHALLENGE' });
    this.challenge = Buffer.from(challenge, 'base64');
  }

  // Step 2: send back the PIN; returns credentials to persist.
  async authorizePin(pin) {
    if (!this.challenge) throw new VieraError('Request a PIN first', { code: 'NO_CHALLENGE' });
    if (!/^\d{4}$/.test(String(pin))) throw new VieraError('PIN must be 4 digits', { code: 'BAD_PIN' });
    const { key, hmacKey, iv } = pairingKeys(this.challenge);
    const authInfo = encrypt(`<X_PinCode>${pin}</X_PinCode>`, key, hmacKey, iv);
    let res;
    try {
      res = await this.rawSoap(URL_NRC, URN_NRC, 'X_RequestAuth', `<X_AuthInfo>${authInfo}</X_AuthInfo>`);
    } catch (err) {
      if (err.status === 500) throw new VieraError('Wrong PIN, or the PIN expired. Request a new one.', { code: 'BAD_PIN' });
      throw err;
    }
    const result = decrypt(xmlText(res, 'X_AuthResult'), key, hmacKey, iv);
    this.appId = xmlText(result, 'X_ApplicationId');
    this.encKey = xmlText(result, 'X_Keyword');
    this.challenge = null;
    this.session = null;
    if (!this.paired) throw new VieraError('Pairing response was missing credentials', { code: 'BAD_AUTH' });
    return { appId: this.appId, encKey: this.encKey };
  }

  // --- remote features ---------------------------------------------------------

  sendKey(key) {
    if (!/^NRC_[A-Z0-9_]+-ONOFF$/.test(key)) throw new VieraError(`Unknown key ${key}`, { code: 'BAD_KEY' });
    return this.nrc('X_SendKey', `<X_KeyEvent>${key}</X_KeyEvent>`);
  }

  launchApp(productId) {
    if (!/^[0-9A-Za-z]+$/.test(productId)) throw new VieraError('Bad app id', { code: 'BAD_APP' });
    return this.nrc('X_LaunchApp', `<X_AppType>vc_app</X_AppType><X_LaunchKeyword>product_id=${productId}</X_LaunchKeyword>`);
  }

  async getApps() {
    const res = await this.nrc('X_GetAppList', '');
    const list = xmlText(res, 'X_AppList') || '';
    // Format: vc_app'product_id=XXXX'XXXX'Name'port'iconUrl'...
    return list
      .split('vc_app')
      .slice(1)
      .map((entry) => entry.split("'"))
      .filter((p) => p[1] && p[1].startsWith('product_id='))
      .map((p) => ({ id: p[1].slice('product_id='.length), name: p[3] }));
  }

  // Volume & mute use the standard (unencrypted) UPnP RenderingControl service.
  async getVolume() {
    const res = await this.rawSoap(URL_DMR, URN_RENDER, 'GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>');
    return Number(xmlText(res, 'CurrentVolume'));
  }

  async setVolume(level) {
    const v = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (Number.isNaN(v)) throw new VieraError('Volume must be a number', { code: 'BAD_VOLUME' });
    await this.rawSoap(URL_DMR, URN_RENDER, 'SetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${v}</DesiredVolume>`);
    return v;
  }

  async getMute() {
    const res = await this.rawSoap(URL_DMR, URN_RENDER, 'GetMute', '<InstanceID>0</InstanceID><Channel>Master</Channel>');
    return xmlText(res, 'CurrentMute') === '1';
  }

  async setMute(muted) {
    await this.rawSoap(URL_DMR, URN_RENDER, 'SetMute', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? 1 : 0}</DesiredMute>`);
    return Boolean(muted);
  }
}

module.exports = { VieraTV, VieraError, DEFAULT_PORT, _internal: { encrypt, decrypt, pairingKeys, sessionKeys, xmlText } };
