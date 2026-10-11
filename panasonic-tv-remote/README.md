# Panasonic TV Remote

Control a Panasonic Viera TV over WiFi from your phone (or any browser).

A small Node.js server runs on a computer on your home network and relays
commands to the TV's built-in network remote API (port 55000). You open the
remote page on your phone. It has no dependencies, so there's nothing to install.

Features: power, input/HDMI, D-pad, back/home/menu/exit, volume slider and
mute, channels, media controls, colour buttons, number pad, guide, and
launching apps (Netflix, YouTube, Prime Video, or any app installed on the TV).
It supports both older Viera sets and the 2019+ models that need PIN pairing
and encrypted commands.

## Setup

1. **On the TV:** Menu → Network → *TV Remote App Settings*. Turn on
   **TV Remote**. To switch the TV on from the app, also turn on
   **Powered On by Apps** (sometimes called *Networked Standby*).
2. **On a computer on the same WiFi** (with Node.js 18 or newer installed), run:

   ```sh
   cd panasonic-tv-remote
   npm start
   ```

   It prints the address to open on your phone, e.g. `http://192.168.1.20:8080`.
3. **On your phone:** open that address. Tap **Search for TVs** (or type the
   TV's IP address, found under Network → Network Status on the TV), then
   **Save & connect**.
4. **If the TV needs pairing** (most 2019+ models), tap **Show PIN on TV**,
   type the 4-digit PIN that appears on screen, and tap **Pair**. You only do
   this once.

Tip: on your phone, use *Add to Home Screen* so it opens like an app.

### Turning the TV on

Over WiFi, the TV can only be switched *off* by the power button. To switch it
*on*, the app sends a Wake-on-LAN packet, which needs:

- the TV's **MAC address** (TV menu → Network → Network Status), entered in the
  app's settings, and
- **Powered On by Apps** enabled on the TV.

Some models only wake this way when connected by Ethernet cable rather than WiFi.

## Configuration

Settings and pairing credentials are saved in `tv-config.json` next to
`server.js`. That file is git-ignored. Delete it to start over.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port the web page is served on |
| `TV_HOST` | – | TV IP address (overrides the saved one) |
| `TV_MAC` | – | TV MAC address for power-on |
| `TV_CONFIG` | `./tv-config.json` | Where settings are stored |

## Tests

```sh
npm test
```

The tests run against a mock TV (`test/mock-tv.js`) that implements both the
plain and the encrypted (PIN-paired) versions of the protocol.

## Troubleshooting

- **"Cannot reach TV" or no TVs found:** check that the TV is on (not in
  standby), on the same network as the computer running the server, and that
  *TV Remote* is enabled. Some routers block devices from seeing each other,
  for example on guest networks or with "AP/client isolation" turned on.
- **"Wrong PIN, or the PIN expired":** the PIN is only valid for a short time.
  Tap *Show PIN on TV* again.
- **Pairing stopped working** (e.g. after a TV reset): open settings and pair
  again.
- **Volume slider does nothing:** a few models don't expose the volume
  service. The VOL +/− buttons still work.

## How it works

- `lib/viera.js`: SOAP client for the TV's `p00NetworkControl` service (keys,
  apps) and UPnP `RenderingControl` service (volume/mute). On encrypted
  models it handles PIN pairing, session setup, and AES-128-CBC + HMAC-SHA256
  wrapping of each command.
- `lib/network.js`: SSDP discovery and Wake-on-LAN.
- `server.js`: JSON API plus the static web page in `public/`.

The server has no authentication. Anyone on your WiFi who can open the page
can control the TV, the same as the official Panasonic app. Don't expose it to
the internet.
