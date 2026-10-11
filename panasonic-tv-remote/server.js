#!/usr/bin/env node
// Runs on a computer on the same WiFi as the TV and serves a remote-control
// web page you can open on your phone. Browsers can't talk to the TV's SOAP
// API directly, so this server relays the commands.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { VieraTV, VieraError } = require('./lib/viera');
const { discover, wakeOnLan, parseMac } = require('./lib/network');

const PORT = Number(process.env.PORT) || 8080;
const CONFIG_FILE = process.env.TV_CONFIG || path.join(__dirname, 'tv-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- config -------------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

let config = loadConfig();
if (process.env.TV_HOST) config.host = process.env.TV_HOST;
if (process.env.TV_MAC) config.mac = process.env.TV_MAC;
let tv = config.host ? new VieraTV(config) : null;

function requireTv() {
  if (!tv) throw new VieraError('No TV set up yet. Pick or enter your TV first.', { code: 'NO_TV' });
  return tv;
}

async function status() {
  const base = { configured: Boolean(tv), host: config.host || null, mac: config.mac || null, name: config.name || null };
  if (!tv) return base;
  try {
    const encrypted = await tv.detectEncryption();
    const result = { ...base, reachable: true, encrypted, paired: !encrypted || tv.paired };
    try {
      result.volume = await tv.getVolume();
      result.muted = await tv.getMute();
    } catch {}
    return result;
  } catch (err) {
    return { ...base, reachable: false, error: err.message };
  }
}

// --- API routes ---------------------------------------------------------------

const routes = {
  'GET /api/status': () => status(),

  'GET /api/discover': async () => ({ tvs: await discover() }),

  'POST /api/setup': async ({ host, mac, name }) => {
    if (!host || !/^[\w.-]+$/.test(host)) throw new VieraError('Enter the TV IP address, e.g. 192.168.1.50', { code: 'BAD_HOST' });
    if (mac) parseMac(mac);
    const keepCreds = host === config.host;
    config = { host, mac: mac || (keepCreds ? config.mac : undefined), name: name || undefined };
    if (keepCreds) Object.assign(config, { appId: tv?.appId || undefined, encKey: tv?.encKey || undefined });
    saveConfig(config);
    tv = new VieraTV(config);
    return status();
  },

  'POST /api/pair/start': async () => {
    await requireTv().requestPin();
    return { ok: true };
  },

  'POST /api/pair/finish': async ({ pin }) => {
    const creds = await requireTv().authorizePin(String(pin || '').trim());
    config = { ...config, ...creds };
    saveConfig(config);
    return { ok: true };
  },

  'POST /api/key': async ({ key }) => {
    await requireTv().sendKey(String(key));
    return { ok: true };
  },

  'POST /api/power-on': async () => {
    if (!config.mac) throw new VieraError('Add the TV MAC address in Settings to turn it on over WiFi.', { code: 'NO_MAC' });
    await wakeOnLan(config.mac);
    return { ok: true };
  },

  'POST /api/volume': async ({ level }) => ({ volume: await requireTv().setVolume(level) }),

  'POST /api/mute': async ({ muted }) => ({ muted: await requireTv().setMute(Boolean(muted)) }),

  'GET /api/apps': async () => ({ apps: await requireTv().getApps() }),

  'POST /api/app': async ({ id }) => {
    await requireTv().launchApp(String(id));
    return { ok: true };
  },
};

// --- HTTP plumbing ------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new VieraError('Invalid JSON', { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) {
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res);
  }
  // Reject cross-site requests so other web pages can't drive the TV through this server.
  if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') {
    return sendJson(res, 415, { error: 'Expected application/json' });
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    sendJson(res, 200, await handler(body));
  } catch (err) {
    const known = err instanceof VieraError || err.message?.startsWith('MAC address');
    if (!known) console.error(err);
    sendJson(res, known ? 400 : 500, { error: err.message, code: err.code });
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Panasonic TV Remote running.`);
    console.log(`  On this computer: http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  On your phone:    http://${ip}:${PORT}`);
    console.log(config.host ? `  TV: ${config.host}${config.appId ? ' (paired)' : ''}` : '  No TV configured yet; open the page to set one up.');
  });
}

module.exports = { server };
