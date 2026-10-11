const $ = (sel) => document.querySelector(sel);

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code });
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function buzz() {
  navigator.vibrate?.(12);
}

// --- status ----------------------------------------------------------------------

let state = {};

function renderStatus() {
  const dot = $('#status-dot');
  dot.className = 'dot ' + (state.reachable ? 'on' : state.configured ? 'off' : '');
  $('#tv-label').textContent = !state.configured
    ? 'No TV set up'
    : `${state.name || 'Panasonic TV'} · ${state.host}${state.reachable ? '' : ' (offline)'}`;
  if (typeof state.volume === 'number' && !volumeDragging) {
    $('#volume').value = state.volume;
    $('#volume-value').textContent = state.volume;
  }
  $('#mute').classList.toggle('muted', Boolean(state.muted));
  $('#pair-box').hidden = !(state.reachable && state.encrypted);
}

async function refresh() {
  try {
    state = await api('/api/status');
  } catch {
    state = { configured: false };
  }
  renderStatus();
  return state;
}

// --- key buttons (with press-and-hold repeat) -------------------------------------

async function sendKey(key) {
  try {
    await api('/api/key', { key });
    if (key === 'NRC_VOLUP-ONOFF' || key === 'NRC_VOLDOWN-ONOFF' || key === 'NRC_MUTE-ONOFF') scheduleRefresh();
  } catch (err) {
    handleError(err);
  }
}

function handleError(err) {
  if (err.code === 'NO_TV' || err.code === 'NOT_PAIRED') openSettings();
  toast(err.message);
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 400);
}

document.querySelectorAll('[data-key]').forEach((btn) => {
  const key = btn.dataset.key;
  let holdTimer, repeatTimer;
  const stop = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
    btn.classList.remove('pressed');
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    btn.classList.add('pressed');
    buzz();
    sendKey(key);
    if (btn.hasAttribute('data-repeat')) {
      holdTimer = setTimeout(() => (repeatTimer = setInterval(() => sendKey(key), 180)), 450);
    }
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  // Keyboard activation (Enter/Space) arrives as a click with no pointer.
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) sendKey(key);
  });
});

// --- power, volume, mute, apps --------------------------------------------------

$('#power-on').addEventListener('click', async () => {
  buzz();
  try {
    await api('/api/power-on', {});
    toast('Wake-up signal sent');
    setTimeout(refresh, 5000);
  } catch (err) {
    handleError(err);
  }
});

let volumeDragging = false;
const volume = $('#volume');
volume.addEventListener('input', () => {
  volumeDragging = true;
  $('#volume-value').textContent = volume.value;
});
volume.addEventListener('change', async () => {
  try {
    const { volume: v } = await api('/api/volume', { level: Number(volume.value) });
    state.volume = v;
  } catch (err) {
    handleError(err);
  } finally {
    volumeDragging = false;
  }
});

$('#mute').addEventListener('click', async () => {
  buzz();
  try {
    const { muted } = await api('/api/mute', { muted: !state.muted });
    state.muted = muted;
    renderStatus();
  } catch (err) {
    handleError(err);
  }
});

async function launchApp(id) {
  buzz();
  try {
    await api('/api/app', { id });
  } catch (err) {
    handleError(err);
  }
}

$('#apps').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-app]');
  if (btn) launchApp(btn.dataset.app);
});

let appsLoaded = false;
$('#apps-drawer').addEventListener('toggle', async (e) => {
  if (!e.target.open || appsLoaded) return;
  try {
    const { apps } = await api('/api/apps');
    if (!apps.length) return;
    appsLoaded = true;
    const box = $('#apps');
    box.replaceChildren(
      ...apps.map((app) => {
        const b = document.createElement('button');
        b.className = 'btn pill app';
        b.dataset.app = app.id;
        b.textContent = app.name;
        return b;
      }),
    );
  } catch {
    // Keep the built-in shortcuts if the TV can't list its apps.
  }
});

// --- settings ---------------------------------------------------------------------

const dialog = $('#settings');
const msg = (text, kind = '') => {
  const el = $('#settings-msg');
  el.textContent = text;
  el.className = 'msg ' + kind;
};

function openSettings() {
  $('#host').value = state.host || '';
  $('#mac').value = state.mac || '';
  msg('');
  if (!dialog.open) dialog.showModal();
}

$('#open-settings').addEventListener('click', openSettings);

// Enter in a field shouldn't close the dialog; treat it as "Save".
$('#settings-form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'cancel') {
    e.preventDefault();
    save();
  }
});

$('#discover').addEventListener('click', async () => {
  const box = $('#found');
  box.replaceChildren();
  msg('Searching your network…');
  try {
    const { tvs } = await api('/api/discover');
    if (!tvs.length) return msg('No Panasonic TVs found. Check the TV is on and TV Remote is enabled, or enter its IP manually.', 'error');
    msg(`Found ${tvs.length} TV${tvs.length > 1 ? 's' : ''}. Tap to select.`);
    for (const tv of tvs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tv.name;
      const small = document.createElement('small');
      small.textContent = [tv.host, tv.model].filter(Boolean).join(' · ');
      b.append(small);
      b.addEventListener('click', () => {
        $('#host').value = tv.host;
        save(tv.name);
      });
      box.append(b);
    }
  } catch (err) {
    msg(err.message, 'error');
  }
});

async function save(name) {
  const host = $('#host').value.trim();
  if (!host) return msg('Enter the TV IP address.', 'error');
  msg('Connecting…');
  try {
    state = await api('/api/setup', { host, mac: $('#mac').value.trim() || undefined, name: name || state.name || undefined });
    renderStatus();
    if (!state.reachable) return msg(state.error || 'Saved, but the TV is not responding.', 'error');
    if (state.encrypted && !state.paired) return msg('Connected. This TV needs pairing — see below.', 'success');
    msg('Connected!', 'success');
    setTimeout(() => dialog.close(), 700);
  } catch (err) {
    msg(err.message, 'error');
  }
}

$('#save').addEventListener('click', () => save());

$('#pair-start').addEventListener('click', async () => {
  msg('Asking the TV to show a PIN…');
  try {
    await api('/api/pair/start', {});
    msg('Enter the PIN shown on your TV.');
    $('#pin').focus();
  } catch (err) {
    msg(err.message, 'error');
  }
});

$('#pair-finish').addEventListener('click', async () => {
  try {
    await api('/api/pair/finish', { pin: $('#pin').value });
    $('#pin').value = '';
    msg('Paired! You can now use the remote.', 'success');
    await refresh();
    setTimeout(() => dialog.close(), 900);
  } catch (err) {
    msg(err.message, 'error');
  }
});

// --- boot ---------------------------------------------------------------------------

refresh().then((s) => {
  if (!s.configured || (s.encrypted && !s.paired)) openSettings();
});
setInterval(() => document.visibilityState === 'visible' && refresh(), 15000);
