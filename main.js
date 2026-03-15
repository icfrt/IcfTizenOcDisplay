const SLIDE_INTERVAL_MS = 10000;
const SYNC_INTERVAL_MS = 60 * 1000;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard limit per image
// Retry delays (ms) after a failed sync: 5s, 15s, 30s, 60s, then normal interval
const SYNC_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

const DB_NAME = 'icf-slides';
const DB_VERSION = 1;
const DB_STORE = 'images';

const CONFIG_SERVER_URL = (window.appConfig && window.appConfig.configServerUrl) || '';
const PROVISION_POLL_MS = 5000;
const PAIRING_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const DEVICE_ID_FILENAME = 'icf-device-id';

let slides = [];
let currentSlideIndex = -1;
let activeSlide = "A";
let slideTimer = null;
let imageDB = null;
let syncRetryCount = 0;
let syncScheduleTimer = null;
let deviceId = null;

const state = {
  webdavUrl: '',
  username: '',
  password: '',
};

const statusEl = () => document.getElementById("status");

function log(status, level = 'info') {
  const s = statusEl();
  if (s) {
    if (level === 'error') {
      s.textContent = status;
      s.style.display = 'block';
    } else {
      s.textContent = '';
      s.style.display = 'none';
    }
  }

  if (level === 'error') {
    console.error(status);
  } else {
    console.debug(status);
  }
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

function generatePairingCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PAIRING_CHARS[Math.floor(Math.random() * PAIRING_CHARS.length)];
  }
  return code;
}

function showProvisioningScreen(code) {
  const el = document.getElementById('provision');
  if (!el) return;
  const codeEl = document.getElementById('provision-code');
  const urlEl = document.getElementById('provision-url');
  if (codeEl) codeEl.textContent = code;
  if (urlEl) urlEl.textContent = CONFIG_SERVER_URL.replace(/config\.php$/, 'setup.php');
  el.classList.add('visible');
}

function hideProvisioningScreen() {
  const el = document.getElementById('provision');
  if (el) el.classList.remove('visible');
}

function generateDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function loadOrCreateDeviceId() {
  return new Promise((resolve) => {
    if (typeof tizen === 'undefined') {
      // Browser testing: use localStorage as stand-in
      let id = localStorage.getItem('icf-device-id');
      if (!id) {
        id = generateDeviceId();
        localStorage.setItem('icf-device-id', id);
      }
      resolve(id);
      return;
    }
    tizen.filesystem.resolve('documents', (dir) => {
      try {
        const file = dir.resolve(DEVICE_ID_FILENAME);
        file.openStream('r', (s) => {
          try {
            const id = s.read(file.fileSize).trim();
            s.close();
            resolve(id || null);
          } catch (_) { resolve(null); }
        }, () => resolve(null), 'UTF-8');
      } catch (_) {
        // File doesn't exist — generate and save a new UUID
        const id = generateDeviceId();
        try {
          const file = dir.createFile(DEVICE_ID_FILENAME);
          file.openStream('w', (s) => {
            try { s.write(id); } finally { s.close(); }
            resolve(id);
          }, () => resolve(id), 'UTF-8');
        } catch (__) { resolve(id); }
      }
    }, () => {
      // Filesystem unavailable — generate ephemeral ID
      resolve(generateDeviceId());
    }, 'rw');
  });
}

async function checkDeviceConfig(id) {
  if (!id || !CONFIG_SERVER_URL) return null;
  try {
    const res = await fetch(CONFIG_SERVER_URL + '?device=' + encodeURIComponent(id));
    if (res.status === 200) return await res.json();
  } catch (_) {}
  return null;
}

async function enterReprovisioningMode() {
  // Clear stored config (filesystem + localStorage) but keep device UUID
  await writeConfigToFilesystem({});
  localStorage.removeItem('owncloud.webdavUrl');
  localStorage.removeItem('owncloud.username');
  localStorage.removeItem('owncloud.password');
  state.webdavUrl = '';
  state.username  = '';
  state.password  = '';

  // Check if server already has updated config for this device
  const cfg = await checkDeviceConfig(deviceId);
  if (cfg && cfg.webdavUrl && cfg.username && cfg.password) {
    await applyAndStoreConfig(cfg);
    return; // Resume slideshow without showing provisioning screen
  }

  // No server config — show normal pairing screen
  const code = generatePairingCode();
  showProvisioningScreen(code);
  let config;
  try {
    config = await pollForConfig(code, deviceId);
  } catch (err) {
    log('Re-provisioning failed: ' + err.message, 'error');
    return;
  }
  await applyAndStoreConfig(config);
  hideProvisioningScreen();
}

function pollForConfig(code, id) {
  return new Promise((resolve, reject) => {
    let url = CONFIG_SERVER_URL + '?code=' + encodeURIComponent(code);
    if (id) url += '&device=' + encodeURIComponent(id);

    function attempt() {
      fetch(url)
        .then(res => {
          if (res.status === 200) {
            return res.json().then(config => resolve(config));
          } else if (res.status === 404 || res.status >= 500) {
            // Not provisioned yet, or transient server error — try again
            setTimeout(attempt, PROVISION_POLL_MS);
          } else {
            reject(new Error('Unexpected response from config server: ' + res.status));
          }
        })
        .catch(() => {
          // Network error — keep polling
          setTimeout(attempt, PROVISION_POLL_MS);
        });
    }

    attempt();
  });
}

async function applyAndStoreConfig(config) {
  state.webdavUrl = config.webdavUrl || '';
  state.username  = config.username  || '';
  state.password  = config.password  || '';
  // Write to both stores: filesystem is the durable primary, localStorage is
  // the quick fallback for environments where tizen.filesystem is unavailable.
  await writeConfigToFilesystem({ webdavUrl: state.webdavUrl, username: state.username, password: state.password });
  localStorage.setItem('owncloud.webdavUrl', state.webdavUrl);
  localStorage.setItem('owncloud.username',  state.username);
  localStorage.setItem('owncloud.password',  state.password);
}

// ─── Persistent config storage ────────────────────────────────────────────────
// Primary store: tizen.filesystem `documents` virtual root — survives app
// updates and reinstalls.  Falls back to localStorage for browser testing.

const CONFIG_FILENAME = 'icf-display-config.json';

function readConfigFromFilesystem() {
  return new Promise((resolve) => {
    if (typeof tizen === 'undefined') { resolve(null); return; }
    tizen.filesystem.resolve('documents', (dir) => {
      try {
        const file = dir.resolve(CONFIG_FILENAME);
        const stream = file.openStream('r', (s) => {
          try {
            const text = s.read(file.fileSize);
            s.close();
            resolve(JSON.parse(text));
          } catch (_) { resolve(null); }
        }, () => resolve(null), 'UTF-8');
      } catch (_) { resolve(null); }
    }, () => resolve(null), 'r');
  });
}

function writeConfigToFilesystem(config) {
  return new Promise((resolve) => {
    if (typeof tizen === 'undefined') { resolve(); return; }
    tizen.filesystem.resolve('documents', (dir) => {
      try {
        let file;
        try { file = dir.resolve(CONFIG_FILENAME); }
        catch (_) { file = dir.createFile(CONFIG_FILENAME); }
        file.openStream('w', (s) => {
          try { s.write(JSON.stringify(config)); } finally { s.close(); }
          resolve();
        }, () => resolve(), 'UTF-8');
      } catch (_) { resolve(); }
    }, () => resolve(), 'rw');
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  // 1. Try persistent filesystem (survives reinstalls)
  let cfg = await readConfigFromFilesystem();

  // 2. Fall back to localStorage (warm start in browser, or pre-migration TVs)
  if (!cfg) {
    const url = localStorage.getItem('owncloud.webdavUrl');
    const user = localStorage.getItem('owncloud.username');
    const pass = localStorage.getItem('owncloud.password');
    if (url && user && pass) {
      cfg = { webdavUrl: url, username: user, password: pass };
      // Migrate to filesystem so future boots are durable
      await writeConfigToFilesystem(cfg);
    }
  }

  if (cfg) {
    state.webdavUrl = cfg.webdavUrl || '';
    state.username  = cfg.username  || '';
    state.password  = cfg.password  || '';
  }
}

function isProvisioned() {
  return !!(state.webdavUrl && state.username && state.password);
}

function basicAuthHeader() {
  if (!state.username || !state.password) return {};
  const token = btoa(`${state.username}:${state.password}`);
  return { Authorization: `Basic ${token}` };
}

function isImageFile(name) {
  const normalized = name.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => normalized.endsWith(ext));
}

// ─── IndexedDB storage ───────────────────────────────────────────────────────

function openImageDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'filename' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

// Stores or replaces a record: { filename, blob, lastmodified, size }
function dbPutImage(record) {
  return new Promise((resolve, reject) => {
    const tx = imageDB.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

function dbGetAllImages() {
  return new Promise((resolve, reject) => {
    const tx = imageDB.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbGetImage(filename) {
  return new Promise((resolve, reject) => {
    const tx = imageDB.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(filename);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror = e => reject(e.target.error);
  });
}

function dbDeleteImage(filename) {
  return new Promise((resolve, reject) => {
    const tx = imageDB.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(filename);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

// ─── Slideshow ────────────────────────────────────────────────────────────────

async function loadLocalImages() {
  const records = await dbGetAllImages();
  const oldSlides = slides;

  slides = records.map(record => ({
    filename: record.filename,
    objectUrl: URL.createObjectURL(record.blob),
  }));

  // Revoke old object URLs after building the new array.
  // Safe to do even if a URL is currently displayed — Chromium keeps the
  // underlying resource alive as long as an element references it.
  for (const slide of oldSlides) {
    URL.revokeObjectURL(slide.objectUrl);
  }

  if (slides.length === 0) {
    log('No images in local storage.');
  } else {
    log(`${slides.length} local images loaded for slideshow`);
  }
}

function showSlide(index) {
  if (slides.length === 0) return;
  currentSlideIndex = (index + slides.length) % slides.length;
  const entry = slides[currentSlideIndex];
  if (!entry) return;

  const nextSlide = activeSlide === 'A' ? 'B' : 'A';
  const currentImage = document.getElementById(`slide${activeSlide}`);
  const nextImage = document.getElementById(`slide${nextSlide}`);

  nextImage.onerror = () => log(`Failed to display ${entry.filename}`, 'error');
  nextImage.src = entry.objectUrl;
  nextImage.style.opacity = '1';
  if (currentImage) currentImage.style.opacity = '0';
  activeSlide = nextSlide;

  log(`Displaying slide ${currentSlideIndex + 1} / ${slides.length}: ${entry.filename}`);
}

function startSlideshow() {
  if (slides.length === 0) {
    log('No slides to show.');
    return;
  }

  if (slideTimer) clearInterval(slideTimer);
  let index = 0;
  showSlide(index);
  slideTimer = setInterval(() => {
    index += 1;
    showSlide(index);
  }, SLIDE_INTERVAL_MS);
  log('Slideshow started.');
}

// ─── Remote sync ──────────────────────────────────────────────────────────────

async function listRemoteImages() {
  if (!state.webdavUrl) throw new Error('WebDAV URL is not set');

  const url = state.webdavUrl.replace(/\/+$/, '') + '/';
  const headers = Object.assign({ 'Depth': '1', 'Content-Type': 'application/xml' }, basicAuthHeader());
  const propfindBody = `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:">\n  <d:prop><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/></d:prop>\n</d:propfind>`;

  const res = await fetch(url, { method: 'PROPFIND', headers, body: propfindBody });
  if (!res.ok) throw new Error(`PROPFIND failed: ${res.status} ${res.statusText}`);

  const text = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const base = new URL(url).origin;
  const props = Array.from(xml.getElementsByTagNameNS('DAV:', 'response')).map(response => {
    const hrefNode = response.getElementsByTagNameNS('DAV:', 'href')[0];
    if (!hrefNode) return null;
    let href = decodeURIComponent(hrefNode.textContent.trim());
    if (!href) return null;

    const filename = href.split('/').filter(Boolean).pop();
    if (!filename || !isImageFile(filename)) return null;

    const prop = response.getElementsByTagNameNS('DAV:', 'prop')[0];
    if (!prop) return null;

    const type = prop.getElementsByTagNameNS('DAV:', 'getcontenttype')[0];
    if (type && type.textContent && /directory/i.test(type.textContent)) return null;

    const lengthNode = prop.getElementsByTagNameNS('DAV:', 'getcontentlength')[0];
    const lastmodNode = prop.getElementsByTagNameNS('DAV:', 'getlastmodified')[0];

    let remoteUrl = href;
    if (!/^https?:\/\//i.test(remoteUrl)) {
      if (remoteUrl.startsWith('/')) remoteUrl = base + remoteUrl;
      else remoteUrl = base + '/' + remoteUrl;
    }

    return {
      filename,
      url: remoteUrl,
      size: lengthNode ? parseInt(lengthNode.textContent.trim(), 10) : 0,
      lastmodified: lastmodNode ? lastmodNode.textContent.trim() : '',
    };
  }).filter(item => item !== null);

  return props;
}

async function syncImages() {
  log('Sync started...');
  try {
    const remoteFiles = await listRemoteImages();
    const remoteNames = remoteFiles.map(r => r.filename);
    let changedCount = 0;

    for (const remote of remoteFiles) {
      const stored = await dbGetImage(remote.filename);
      const remoteMod = remote.lastmodified || '';

      const needDownload = !stored || stored.lastmodified !== remoteMod || stored.size !== remote.size;
      if (!needDownload) continue;

      // Guard: reject oversized files before downloading using the size reported by WebDAV
      if (remote.size > MAX_DOWNLOAD_BYTES) {
        log(`Skipping ${remote.filename}: ${(remote.size / 1024 / 1024).toFixed(1)} MB exceeds 50 MB limit`, 'error');
        continue;
      }

      // If we already have a copy, ask the server to skip the body if nothing changed.
      // This covers the case where size or lastmodified metadata drifted (e.g. server
      // re-indexed) but the actual file content is the same.
      const fetchHeaders = Object.assign({}, basicAuthHeader());
      if (stored && stored.lastmodified) {
        fetchHeaders['If-Modified-Since'] = stored.lastmodified;
      }

      const response = await fetch(remote.url, { headers: fetchHeaders });

      if (response.status === 304) {
        // Server confirms the file hasn't changed — sync our stored metadata to the
        // current PROPFIND values so we don't re-check on the next cycle.
        await dbPutImage({ ...stored, lastmodified: remoteMod, size: remote.size });
        log(`${remote.filename} unchanged (304)`);
        continue;
      }

      if (!response.ok) {
        log(`Skipping ${remote.filename}: HTTP ${response.status} ${response.statusText}`, 'error');
        continue;
      }

      // Guard: also check Content-Length from response headers (may differ from PROPFIND size)
      const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
      if (contentLength > MAX_DOWNLOAD_BYTES) {
        log(`Skipping ${remote.filename}: Content-Length ${(contentLength / 1024 / 1024).toFixed(1)} MB exceeds 50 MB limit`, 'error');
        continue;
      }

      const blob = await response.blob();

      // Guard: verify actual downloaded size in case Content-Length was absent or wrong
      if (blob.size > MAX_DOWNLOAD_BYTES) {
        log(`Skipping ${remote.filename}: downloaded ${(blob.size / 1024 / 1024).toFixed(1)} MB exceeds 50 MB limit`, 'error');
        continue;
      }

      await dbPutImage({ filename: remote.filename, blob, lastmodified: remoteMod, size: remote.size });
      changedCount++;
      log(`Downloaded/updated ${remote.filename}`);

      // Start slideshow as soon as the first image is available — don't wait for the full sync
      if (!slideTimer) {
        await loadLocalImages();
        if (slides.length > 0) startSlideshow();
      }
    }

    // Remove images no longer present on the server
    const allStored = await dbGetAllImages();
    for (const stored of allStored) {
      if (!remoteNames.includes(stored.filename)) {
        await dbDeleteImage(stored.filename);
        log(`Removed stale image ${stored.filename}`);
      }
    }

    await loadLocalImages();

    if (slides.length === 0) log('No images available.');
    else log(`${slides.length} images ready (${changedCount} updated)`);

    return true;
  } catch (err) {
    log(`Sync error: ${err.message}`, 'error');
    return false;
  }
}

function scheduleNextSync(isRetry) {
  if (syncScheduleTimer) clearTimeout(syncScheduleTimer);
  let delay;
  if (isRetry && syncRetryCount <= SYNC_RETRY_DELAYS_MS.length) {
    delay = SYNC_RETRY_DELAYS_MS[Math.min(syncRetryCount - 1, SYNC_RETRY_DELAYS_MS.length - 1)];
    log(`Sync failed. Retrying in ${delay / 1000}s (attempt ${syncRetryCount} of ${SYNC_RETRY_DELAYS_MS.length})…`, 'error');
  } else {
    delay = SYNC_INTERVAL_MS;
    syncRetryCount = 0;
  }
  syncScheduleTimer = setTimeout(runSync, delay);
}

async function runSync() {
  const success = await syncImages();
  if (success) {
    syncRetryCount = 0;
    if (slides.length > 0 && !slideTimer) {
      startSlideshow();
    }
    // Check for server-pushed credential updates
    const updated = await checkDeviceConfig(deviceId);
    if (updated && updated.webdavUrl && updated.username && updated.password) {
      if (updated.webdavUrl !== state.webdavUrl ||
          updated.username  !== state.username  ||
          updated.password  !== state.password) {
        log('Credentials updated from server.');
        await applyAndStoreConfig(updated);
      }
    }
    scheduleNextSync(false);
  } else {
    syncRetryCount++;
    scheduleNextSync(true);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Long-press Back (≥3s) → re-provisioning; short press → exit.
  // keydown/keyup give us the hold duration; tizenhwkey is not used.
  let backPressStart = null;
  document.addEventListener('keydown', event => {
    if (event.key === 'XF86Back' || event.keyCode === 10009) {
      if (backPressStart === null) backPressStart = Date.now();
    }
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'XF86Back' || event.keyCode === 10009) {
      if (backPressStart === null) return;
      const held = Date.now() - backPressStart;
      backPressStart = null;
      if (held >= 3000) {
        enterReprovisioningMode().catch(err => log('Re-provisioning error: ' + err.message, 'error'));
      } else {
        tizen.application.getCurrentApplication().exit();
      }
    }
  });

  deviceId = await loadOrCreateDeviceId();

  await loadConfig();

  if (!isProvisioned()) {
    // Server may already have config for this device (e.g. admin pre-updated)
    const serverCfg = await checkDeviceConfig(deviceId);
    if (serverCfg && serverCfg.webdavUrl && serverCfg.username && serverCfg.password) {
      await applyAndStoreConfig(serverCfg);
    } else {
      const code = generatePairingCode();
      showProvisioningScreen(code);
      let config;
      try {
        config = await pollForConfig(code, deviceId);
      } catch (err) {
        log('Provisioning failed: ' + err.message, 'error');
        return;
      }
      await applyAndStoreConfig(config);
      hideProvisioningScreen();
    }
  }

  try {
    imageDB = await openImageDB();
  } catch (e) {
    log('Could not open local image database.', 'error');
    return;
  }

  // Load whatever was stored from the last session — works fully offline.
  await loadLocalImages();
  if (slides.length > 0) {
    startSlideshow();
  }

  // Sync in the background; starts slideshow if no local images were available.
  runSync();
}

window.onload = () => {
  if (typeof tizen === 'undefined') {
    log('Tizen API unavailable; run on TV/emulator.');
    return;
  }

  init().catch(err => log('Init failed: ' + err.message, 'error'));
};
