// LAN helpers: SSDP discovery of Viera TVs and Wake-on-LAN for powering on.

const dgram = require('node:dgram');
const http = require('node:http');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const VIERA_ST = 'urn:panasonic-com:device:p00RemoteController:1';

function fetchText(url, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(''));
  });
}

function tag(xml, name) {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

// Broadcasts an SSDP M-SEARCH and resolves with the Viera TVs that answered.
function discover({ timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const message = Buffer.from(
      ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDR}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${VIERA_ST}`, '', ''].join('\r\n'),
    );

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString();
      if (!text.includes('p00RemoteController') || found.has(rinfo.address)) return;
      const location = /^location:\s*(.+)$/im.exec(text)?.[1]?.trim();
      found.set(rinfo.address, { host: rinfo.address, location });
    });
    socket.on('error', () => finish());

    let done = false;
    async function finish() {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {}
      const tvs = await Promise.all(
        [...found.values()].map(async (tv) => {
          const xml = tv.location ? await fetchText(tv.location) : '';
          return { host: tv.host, name: tag(xml, 'friendlyName') || 'Panasonic TV', model: tag(xml, 'modelNumber') };
        }),
      );
      resolve(tvs);
    }

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch {}
      socket.send(message, SSDP_PORT, SSDP_ADDR);
      setTimeout(() => socket.send(message, SSDP_PORT, SSDP_ADDR), 500);
    });
    setTimeout(finish, timeout);
  });
}

function parseMac(mac) {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) throw new Error('MAC address must look like AA:BB:CC:DD:EE:FF');
  return Buffer.from(hex, 'hex');
}

// Sends a Wake-on-LAN magic packet. Viera TVs need "Powered On by Apps"
// (or "Networked Standby") enabled for this to work.
function wakeOnLan(mac, { address = '255.255.255.255' } = {}) {
  const macBytes = parseMac(mac);
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      let sent = 0;
      for (const port of [9, 7]) {
        socket.send(packet, port, address, (err) => {
          if (err) return socket.emit('error', err);
          if (++sent === 2) {
            socket.close();
            resolve();
          }
        });
      }
    });
  });
}

module.exports = { discover, wakeOnLan, parseMac };
