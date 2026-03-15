const IMAGE_FOLDER = "images";
const SLIDE_INTERVAL_MS = 10000;
const SYNC_INTERVAL_MS = 60 * 1000;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

const appConfig = window.appConfig || {};
const HARD_CODED_WEBDAV_URL = appConfig.webdavUrl || "https://fallback/";
const HARD_CODED_USERNAME = appConfig.username || "";
const HARD_CODED_PASSWORD = appConfig.password || "";

let slides = [];
let currentSlideIndex = -1;
let activeSlide = "A";
let slideTimer = null;
let imageDirectory = null;

const state = {
  webdavUrl: HARD_CODED_WEBDAV_URL,
  username: HARD_CODED_USERNAME,
  password: HARD_CODED_PASSWORD,
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



function saveConfig() {
  state.webdavUrl = document.getElementById("config-url").value.trim();
  state.username = document.getElementById("config-user").value.trim();
  state.password = document.getElementById("config-pass").value;
  localStorage.setItem("owncloud.webdavUrl", state.webdavUrl);
  localStorage.setItem("owncloud.username", state.username);
  localStorage.setItem("owncloud.password", state.password);
  log("Settings saved.");
}

function loadConfig() {
  // Primary source: hard-coded constants to lock configuration for single-TV use.
  state.webdavUrl = HARD_CODED_WEBDAV_URL;
  state.username = HARD_CODED_USERNAME;
  state.password = HARD_CODED_PASSWORD;

  // Optional override from localStorage if you still want to adjust without code deployment.
  if (localStorage.getItem("owncloud.webdavUrl")) {
    state.webdavUrl = localStorage.getItem("owncloud.webdavUrl");
  }
  if (localStorage.getItem("owncloud.username")) {
    state.username = localStorage.getItem("owncloud.username");
  }
  if (localStorage.getItem("owncloud.password")) {
    state.password = localStorage.getItem("owncloud.password");
  }

  const urlInput = document.getElementById("config-url");
  if (urlInput) urlInput.value = state.webdavUrl;
  const userInput = document.getElementById("config-user");
  if (userInput) userInput.value = state.username;
  const passInput = document.getElementById("config-pass");
  if (passInput) passInput.value = state.password;
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

function getMimeTypeFromName(name) {
  const ext = name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    file.openStream(
      'r',
      stream => {
        try {
          const text = stream.read(file.fileSize || 0);
          stream.close();
          resolve(text);
        } catch (e) {
          stream.close();
          reject(e);
        }
      },
      err => reject(err),
      'UTF-8'
    );
  });
}

function listFilesAsync(directory) {
  return new Promise((resolve, reject) => {
    try {
      directory.listFiles(
        files => resolve(files),
        err => reject(err)
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function getFileFromDirectory(directory, name) {
  try {
    const files = await listFilesAsync(directory);
    return files.find(f => f.isFile && f.name === name) || null;
  } catch (e) {
    return null;
  }
}

function resolveLocalFolder() {
  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve(
      'documents',
      async dir => {
        try {
          const files = await listFilesAsync(dir);
          let folder = dir;
          const existing = files.find(x => x.isDirectory && x.name === IMAGE_FOLDER);
          if (existing) {
            folder = dir.resolve(IMAGE_FOLDER);
          } else {
            folder = dir.createDirectory(IMAGE_FOLDER);
          }
          resolve(folder);
        } catch (e) {
          reject(e);
        }
      },
      e => reject(e),
      'rw'
    );
  });
}

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

async function getFileFromDirectory(directory, name) {
  try {
    const files = await listFilesAsync(directory);
    return files.find(f => f.isFile && f.name === name) || null;
  } catch (e) {
    return null;
  }
}

function loadLocalImageMeta() {
  try {
    const raw = localStorage.getItem('owncloud.imageMeta');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveLocalImageMeta(meta) {
  localStorage.setItem('owncloud.imageMeta', JSON.stringify(meta));
}

async function saveFileFromBlob(directory, filename, blob) {
  let file = await getFileFromDirectory(directory, filename);
  if (!file) {
    file = directory.createFile(filename);
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const base64Data = dataUrl.split(',')[1] || '';

  await new Promise((resolve, reject) => {
    file.openStream(
      'w',
      stream => {
        try {
          stream.write(base64Data);
          stream.close();
          resolve(file);
        } catch (e) {
          stream.close();
          reject(e);
        }
      },
      err => reject(err),
      'UTF-8'
    );
  });

  console.log(`Saved ${filename} to ${file.toURI()} size ${file.fileSize}`);
  return { file, dataUrl, base64Data };
}

async function loadLocalImages() {
  if (!imageDirectory) imageDirectory = await resolveLocalFolder();
  const localFiles = (await listFilesAsync(imageDirectory)).filter(f => f.isFile && isImageFile(f.name));
  slides = [];
  for (const file of localFiles) {
    try {
      const raw = await readFileAsText(file);
      let base64Data;
      if (raw.trim().startsWith('data:')) {
        base64Data = raw.trim().split(',')[1] || '';
      } else {
        base64Data = raw.trim();
      }
      const mimeType = getMimeTypeFromName(file.name);
      const dataUrl = `data:${mimeType};base64,${base64Data}`;
      slides.push({ file, dataUrl });
    } catch (e) {
      console.warn('Reading local file for slideshow failed', file.name, e);
    }
  }
  if (slides.length === 0) {
    log('No images in local folder.');
  } else {
    log(`${slides.length} local images loaded for slideshow`);
  }
}

async function syncImages() {
  log('Sync started...');
  try {
    const remoteFiles = await listRemoteImages();
    if (!imageDirectory) imageDirectory = await resolveLocalFolder();

    const imageMeta = loadLocalImageMeta();
    const remoteNames = remoteFiles.map(r => r.filename);
    let changedCount = 0;

    for (const remote of remoteFiles) {
      const currentFile = await getFileFromDirectory(imageDirectory, remote.filename);
      const stored = imageMeta[remote.filename];
      const remoteMod = remote.lastmodified || '';

      const needDownload = !currentFile || !stored || stored.lastmodified !== remoteMod || stored.size !== remote.size;
      if (!needDownload) continue;

      const response = await fetch(remote.url, { headers: basicAuthHeader() });
      if (!response.ok) {
        console.warn('Skipping', remote.filename, response.status);
        continue;
      }

      const blob = await response.blob();
      const { dataUrl } = await saveFileFromBlob(imageDirectory, remote.filename, blob);

      imageMeta[remote.filename] = {
        lastmodified: remoteMod,
        size: remote.size,
        updatedAt: new Date().toISOString(),
      };

      changedCount++;
      log(`Downloaded/updated ${remote.filename} (${dataUrl ? 'base64 stored' : 'saved'})`);
    }

    // Remove local files that are no longer present remotely
    const localFiles = (await listFilesAsync(imageDirectory)).filter(f => f.isFile && isImageFile(f.name));
    for (const local of localFiles) {
      if (!remoteNames.includes(local.name)) {
        try {
          local.deleteFile();
          delete imageMeta[local.name];
          log(`Removed stale local file ${local.name}`);
        } catch (e) {
          console.warn('Cannot delete stale file', local.name, e);
        }
      }
    }

    saveLocalImageMeta(imageMeta);

    await loadLocalImages();

    if (slides.length === 0) log('No images in local folder.');
    else log(`${slides.length} images ready for slideshow (changed ${changedCount})`);
  } catch (err) {
    console.error(err);
    log(`Sync error: ${err.message}`);
  }
}

async function getDataURLFromFile(file) {
  if (typeof file.readAsDataURL === 'function') {
    return new Promise((resolve, reject) => file.readAsDataURL(resolve, reject));
  }

  const fileUri = file.toURI();
  try {
    const response = await fetch(encodeURI(fileUri));
    if (!response.ok) {
      throw new Error(`Fetch file:// failed ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    throw new Error(`getDataURLFromFile failed: ${err.message || err}`);
  }
}

async function showSlide(index) {
  if (slides.length === 0) return;
  currentSlideIndex = (index + slides.length) % slides.length;
  const nextEntry = slides[currentSlideIndex];
  if (!nextEntry) {
    log(`No slide entry at index ${currentSlideIndex}`);
    return;
  }

  const rawUrl = nextEntry.dataUrl || nextEntry.uri || '';
  if (!rawUrl) {
    log(`No slide URL/dataUrl for ${nextEntry.file ? nextEntry.file.name : 'unknown'}`);
    return;
  }

  const encodedUrl = rawUrl.startsWith('data:')
    ? rawUrl
    : (rawUrl.includes('%') ? rawUrl : encodeURI(rawUrl));

  const currentImage = document.getElementById(`slide${activeSlide}`);
  const nextSlide = activeSlide === 'A' ? 'B' : 'A';
  const nextImage = document.getElementById(`slide${nextSlide}`);

  nextImage.onerror = async () => {
    log(`Image URL failed, attempting DataURL fallback`);
    if (nextEntry.dataUrl) {
      nextImage.src = nextEntry.dataUrl;
      return;
    }
    if (nextEntry.uri) {
      nextImage.src = nextEntry.uri;
      return;
    }
    log('No fallback image source available');
  };

  if (nextEntry.dataUrl) {
    nextImage.src = nextEntry.dataUrl;
  } else if (nextEntry.uri) {
    nextImage.src = nextEntry.uri;
  } else {
    nextImage.src = encodedUrl;
  }
  nextImage.style.opacity = '1';
  if (currentImage) currentImage.style.opacity = '0';
  activeSlide = nextSlide;

  log(`Displaying slide ${currentSlideIndex + 1} / ${slides.length} (path: ${encodedUrl})`);
}

function startSlideshow() {
  if (slides.length === 0) {
    log('No slides found. Please run Sync now.');
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

async function init() {
  window.addEventListener('tizenhwkey', event => {
    if (event.keyName === 'back') {
      tizen.application.getCurrentApplication().exit();
    }
  });

  loadConfig();

  // Optional: keep the direct control buttons removed for single-configuration use.
  // Instead, use hardcoded settings and start automatically.


  try {
    imageDirectory = await resolveLocalFolder();
  } catch (e) {
    console.warn('image folder init failed', e);
    log('Could not initialize local image folder.');
  }

  await loadLocalImages();
  if (slides.length > 0) {
    startSlideshow();
  }

  // Sync in background, then restart slideshow if local images were absent but synced successfully.
  syncImages().then(() => {
    if (slides.length > 0 && !slideTimer) {
      startSlideshow();
    }
  }).catch(e => console.warn('Background sync failed', e));

  setInterval(async () => {
    await syncImages();
  }, SYNC_INTERVAL_MS);
}

window.onload = () => {
  if (typeof tizen === 'undefined') {
    log('Tizen API unavailable; run on TV/emulator.');
    return;
  }

  init().catch(err => log('Init failed: ' + err.message));
};
