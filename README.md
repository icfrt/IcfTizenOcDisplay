# IcfTizenOcDisplay

A small Tizen Web App for Samsung TV (QM75C) that:
- syncs image files from an ownCloud WebDAV folder to the device local storage
- displays them as a slideshow
- cycles images every 10 seconds with a dissolve transition

## Project structure

- `index.html` - app UI layout
- `css/style.css` - slideshow and control styling
- `main.js` - application logic (file sync + slideshow)
- `config.template.js` - configuration template with placeholders
- `config.js` (ignored) - local credentials and URL
- `config.xml` - Tizen widget manifest
- `.gitignore` - ignores sensitive/local files
- `.gitattributes` - line endings config

## Config setup

### Create `config.js`

Copy `config.template.js` to `config.js` and replace placeholders with your own values:

```js
window.appConfig = {
  webdavUrl: "https://your-owncloud-server/remote.php/dav/files/YOUR_USER/YOUR_FOLDER/",
  username: "YOUR_USERNAME",
  password: "YOUR_PASSWORD",
};
```

## Build & run

### 1) Open project in VS Code

Install the Samsung Tizen extension, open this folder as workspace.

### 2) Prepare Tizen certificate profile

Use the extension UI to create a new TV certificate profile.

### 3) Connect to emulator / device

- Start the Tizen emulator or use your connected Samsung QM75C via SDB.
- Ensure device is authorized and appears in `sdb devices`.

### 4) Select target and run

- Choose `Launch` / `Debug` from Tizen extension.
- App will install and run on target device.

### 5) Check logs

- Use `sdb dlog` to view runtime logs.
- On emulator debug mode, console output appears on screen for dev data.

## Notes

- app uses local filesystem privileges in `config.xml`:
  - `http://tizen.org/privilege/filesystem.read`
  - `http://tizen.org/privilege/filesystem.write`
  - `http://tizen.org/privilege/internet`

- Slideshow initialization:
  - loads local images first from `documents/images`
  - starts slideshow immediately
  - background sync updates images and restarts if necessary

- Data flow:
  - ownCloud `PROPFIND` (WebDAV) list images
  - fetch each missing/changed image
  - store base64 in local files (protect via binary workflow)
  - show `data:image/*;base64,...` image URLs in slideshow

## Troubleshooting

- If you see `Chrome is not found` in debugger, install Chrome and configure `chrome_path` in `tizen_workspace.yaml`.
- If you see `Cannot use import statement outside a module`, ensure `config.js` is loaded by plain `<script>` before `main.js`.
