# IcfTizenOcDisplay

A Tizen Web App for Samsung commercial displays (tested on QM75C) that syncs images from an ownCloud/Nextcloud WebDAV folder and shows them as a fullscreen slideshow. Slides cycle every 10 seconds with a dissolve transition. Sync runs every 60 seconds in the background.

---

## Architecture

```
┌─────────────────────────────────────────┐     ┌────────────────────────────────┐
│  Samsung TV (Tizen Web App)             │     │  Web Server (Apache + PHP)     │
│                                         │     │                                │
│  main.js                                │────▶│  server/config.php             │
│   ├─ provisioning (pairing code UI)     │◀────│   ├─ serves config by UUID     │
│   ├─ IndexedDB image cache              │     │   └─ serves config by code     │
│   ├─ WebDAV sync (PROPFIND + fetch)     │     │                                │
│   └─ slideshow (crossfade)              │     │  server/setup.php  (auth'd)    │
│                                         │     │   ├─ pairing form              │
│  Tizen filesystem                       │     │   └─ manage devices            │
│   ├─ icf-display-config.json (creds)    │     │                                │
│   └─ icf-device-id (UUID)               │     │  server/configs/  (temp)       │
└─────────────────────────────────────────┘     │  server/devices/  (permanent)  │
                                                └────────────────────────────────┘
```

The TV never has credentials hardcoded. On first boot it shows a pairing code; the admin enters the code plus WebDAV credentials in `setup.php` (on the webserver, through a browser). Credentials are stored on the TV's filesystem and polled for updates every sync cycle.

---

## Project structure

```
IcfTizenOcDisplay/
├── index.html              App entry point
├── main.js                 All app logic (sync, slideshow, provisioning)
├── css/style.css           Slideshow and provisioning UI styles
├── config.template.js      Template for config.js
├── config.js               (git-ignored) Points to the config server
├── config.xml              Tizen widget manifest (app ID, privileges, version)
├── icon.png                App icon
├── build.bat               Build script → produces Debug/IcfTizenOcDisplay.wgt
├── deploy.bat              Bump version + build + SCP to web server
├── bump_version.py         Increments patch version in config.xml
├── generate_sssp.py        Generates sssp_config.xml from the built WGT
└── server/
    ├── config.php          TV-facing API: serve/store device configs
    ├── setup.php           Admin UI: pair new device, manage existing devices
    ├── .htaccess           Protects setup.php (Basic Auth) + configs/ + devices/
    ├── configs/            Temporary pairing configs ({CODE}.json, deleted after first read)
    └── devices/            Permanent per-device configs ({UUID}.json)
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Tizen Studio](https://developer.tizen.org/development/tizen-studio) or VS Code + Samsung Tizen extension | Build & sign the WGT |
| `TIZEN_TOOLS_PATH` environment variable | Points `build.bat` to `tz.exe` |
| Python 3 | `bump_version.py`, `generate_sssp.py` |
| SSH / SCP access to web server | `deploy.bat` uploads via SCP |
| Apache + PHP (server) | Hosts the provisioning API and admin UI |

Set `TIZEN_TOOLS_PATH` to the folder containing `tizen-core/tz.exe`, e.g.:
```
TIZEN_TOOLS_PATH=C:\tizen-studio
```

---

## Server setup

### 1. Upload server files

Copy the `server/` directory to a web-accessible path on your server, e.g. `/var/www/tizen-display/`.

### 2. Create required directories

```bash
mkdir -p /var/www/tizen-display/configs
mkdir -p /var/www/tizen-display/devices
chown www-data:www-data /var/www/tizen-display/configs /var/www/tizen-display/devices
chmod 750 /var/www/tizen-display/configs
chmod 700 /var/www/tizen-display/devices
```

`configs/` holds temporary pairing codes (deleted after first TV read).
`devices/` holds permanent per-device config files — keep it mode `700`.

### 3. Enable mod_rewrite

The `.htaccess` uses `mod_rewrite` to block direct access to `configs/` and `devices/`. Ensure `AllowOverride All` (or at least `AllowOverride AuthConfig FileInfo`) is set for the directory in your Apache config.

```bash
a2enmod rewrite
systemctl reload apache2
```

### 4. Create the HTTP Basic Auth password file for setup.php

```bash
htpasswd -c /etc/apache2/.htpasswd-display admin
```

The `.htaccess` references `/etc/apache2/.htpasswd-display`. Adjust the path in `.htaccess` if you store it elsewhere.

### 5. Verify

- `https://yourserver/path/config.php` → should return `{"error":"Invalid code format"}` (400)
- `https://yourserver/path/setup.php` → should prompt for HTTP Basic Auth credentials

---

## TV app configuration

### Create `config.js`

Copy `config.template.js` to `config.js` and set the URL to your server's `config.php`:

```js
window.appConfig = {
  configServerUrl: "https://yourserver/path/to/config.php",
};
```

`config.js` is git-ignored. It is bundled into the WGT at build time.

---

## Build

```bat
build.bat
```

Requires `TIZEN_TOOLS_PATH` to be set. Produces:
- `Debug/IcfTizenOcDisplay.wgt` — the signed Tizen widget
- `Debug/sssp_config.xml` — required for Samsung SSSP deployment

The build will warn (but not fail) if `config.js` is missing.

You must have a valid **Tizen certificate profile** configured in Tizen Studio / the VS Code extension before building. Create one via the Certificate Manager UI targeting the `TV` profile.

---

## Deploy

### Option A: Script (recommended)

```bat
deploy.bat user@yourserver.com /var/www/tizen-display
```

This will:
1. Increment the patch version in `config.xml`
2. Run `build.bat`
3. SCP `IcfTizenOcDisplay.wgt` and `sssp_config.xml` to the server

### Option B: Manual SCP

```bat
build.bat
scp Debug\IcfTizenOcDisplay.wgt Debug\sssp_config.xml user@yourserver.com:/var/www/tizen-display/
```

### Installing on the TV

The TV fetches and installs the app via Samsung SSSP (Supersign). On the TV:

1. Go to **Menu → URL Launcher Settings** (or equivalent SSSP entry point)
2. Enter the URL to the directory where `sssp_config.xml` is loacted (without trailing `/`), e.g. `http://yourserver/tizen-display`
3. The TV downloads and installs the WGT automatically

For development/debugging, install directly via SDB:
```bash
sdb connect <TV_IP>
sdb install Debug/IcfTizenOcDisplay.wgt
```

---

## First run: provisioning

On first boot (or after a reset), the TV shows:

```
This display is not configured.
Visit: https://yourserver/path/setup.php
Code:  AB3X7Q
```

1. Open `setup.php` in a browser (enter Basic Auth credentials when prompted)
2. Enter the 6-character code shown on the TV
3. Enter the WebDAV URL, username, and password
4. Click **Save Configuration**

The TV polls every 5 seconds and picks up the config automatically. The pairing code is single-use and deleted from the server after the TV reads it.

---

## Credential updates (without physical access)

If WebDAV credentials change:

1. Open `setup.php` → **Manage Devices**
2. Find the device (by name or UUID), expand it
3. Enter the new password and click **Update Credentials**

The TV picks up the new credentials on its next sync cycle (within 60 seconds). The slideshow continues uninterrupted.

---

## Emergency re-provisioning (long-press Back)

Hold the **Back** button on the TV remote for **3 seconds**. This clears the stored credentials and re-enters provisioning mode.

- If `setup.php` already has updated credentials for this device (pre-configured by admin), the TV skips the pairing screen and resumes immediately.
- Otherwise, a new pairing code is shown and the normal provisioning flow applies.

Short-pressing Back (< 3s) exits the app normally.

---

## Sync behaviour

- Sync runs every **60 seconds** (`SYNC_INTERVAL_MS` in `main.js`)
- Each cycle issues a WebDAV `PROPFIND` to list remote images
- Only changed files (by `lastmodified` + size) are downloaded
- `If-Modified-Since` is sent for files already cached locally
- Files removed from WebDAV are deleted from IndexedDB
- The running slideshow is not interrupted — the updated image set takes effect on the next slide advance
- On sync failure, retries at 5s → 15s → 30s → 60s before returning to the normal interval

---

## Tizen privileges (config.xml)

| Privilege | Used for |
|-----------|----------|
| `internet` | WebDAV sync + config server polling |
| `filesystem.read` | Reading device config and UUID from `documents/` |
| `filesystem.write` | Writing device config and UUID to `documents/` |
| `application.launch` | Exiting the app on short Back press |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `Chrome is not found` in debugger | Install Chrome and set `chrome_path` in `tizen_workspace.yaml` |
| TV shows pairing screen after reinstall | Normal — UUID persists, config does not. Re-pair or update via setup.php |
| `config.php` returns 500 for device lookup | `devices/{UUID}.json` exists but is malformed or unreadable |
| Sync errors in log | Check WebDAV URL trailing slash; verify credentials in Manage Devices |
| `sdb devices` shows no device | Ensure TV is in developer mode and on the same network |
| Build fails with `tz.exe not found` | `TIZEN_TOOLS_PATH` not set or points to wrong directory |
