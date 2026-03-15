<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Display Provisioning</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; }
        h1 { margin-bottom: 24px; }
        label { display: block; margin-top: 16px; font-weight: bold; }
        input { display: block; width: 100%; padding: 8px; margin-top: 4px; font-size: 16px; box-sizing: border-box; }
        button { margin-top: 24px; padding: 10px 24px; font-size: 16px; cursor: pointer; }
        .success { color: green; margin-top: 20px; font-weight: bold; }
        .error { color: red; margin-top: 20px; font-weight: bold; }
    </style>
</head>
<body>
<h1>Display Provisioning</h1>
<?php
$message = '';
$messageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $code     = strtoupper(trim($_POST['code'] ?? ''));
    $webdavUrl = trim($_POST['webdavUrl'] ?? '');
    $username  = trim($_POST['username'] ?? '');
    $password  = $_POST['password'] ?? '';

    // Validate code
    if (!preg_match('/^[A-Z0-9]{6}$/', $code)) {
        $message = 'Invalid pairing code. Must be exactly 6 alphanumeric characters (A-Z, 0-9).';
        $messageType = 'error';
    } elseif (empty($webdavUrl) || !filter_var($webdavUrl, FILTER_VALIDATE_URL)) {
        $message = 'Invalid WebDAV URL.';
        $messageType = 'error';
    } elseif (empty($username)) {
        $message = 'Username is required.';
        $messageType = 'error';
    } elseif (empty($password)) {
        $message = 'Password is required.';
        $messageType = 'error';
    } else {
        $configsDir = __DIR__ . '/configs';
        if (!is_dir($configsDir)) {
            mkdir($configsDir, 0750, true);
        }

        $data = json_encode([
            'webdavUrl' => $webdavUrl,
            'username'  => $username,
            'password'  => $password,
        ]);

        $file = $configsDir . '/' . $code . '.json';
        if (file_put_contents($file, $data) !== false) {
            $message = "Configuration saved for code $code. The display will pick it up within 5 seconds.";
            $messageType = 'success';
        } else {
            $message = 'Failed to write configuration file. Check server permissions.';
            $messageType = 'error';
        }
    }
}
?>
<?php if ($message): ?>
    <p class="<?= htmlspecialchars($messageType) ?>"><?= htmlspecialchars($message) ?></p>
<?php endif; ?>
<form method="post" action="">
    <label for="code">Pairing Code (shown on TV)</label>
    <input type="text" id="code" name="code" maxlength="6" placeholder="e.g. AB3X7Q"
           value="<?= htmlspecialchars($_POST['code'] ?? '') ?>" autocomplete="off" required>

    <label for="webdavUrl">WebDAV URL</label>
    <input type="url" id="webdavUrl" name="webdavUrl" placeholder="https://cloud.example.com/remote.php/dav/files/USER/SLIDES/"
           value="<?= htmlspecialchars($_POST['webdavUrl'] ?? '') ?>" required>

    <label for="username">Username</label>
    <input type="text" id="username" name="username"
           value="<?= htmlspecialchars($_POST['username'] ?? '') ?>" required>

    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>

    <button type="submit">Save Configuration</button>
</form>

<?php
// ── Manage Devices ─────────────────────────────────────────────────────────────
$devicesDir = __DIR__ . '/devices';

$devMessage     = '';
$devMessageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['device'])) {
    $devId      = trim($_POST['device'] ?? '');
    $devName    = trim($_POST['dev_name'] ?? '');
    $devWebdav  = trim($_POST['dev_webdavUrl'] ?? '');
    $devUser    = trim($_POST['dev_username'] ?? '');
    $devPass    = $_POST['dev_password'] ?? '';

    if (!preg_match('/^[0-9a-f\-]{36}$/', $devId)) {
        $devMessage     = 'Invalid device ID.';
        $devMessageType = 'error';
    } elseif (empty($devWebdav) || !filter_var($devWebdav, FILTER_VALIDATE_URL)) {
        $devMessage     = 'Invalid WebDAV URL.';
        $devMessageType = 'error';
    } elseif (empty($devUser)) {
        $devMessage     = 'Username is required.';
        $devMessageType = 'error';
    } elseif (empty($devPass)) {
        $devMessage     = 'Password is required.';
        $devMessageType = 'error';
    } else {
        if (!is_dir($devicesDir)) {
            mkdir($devicesDir, 0700, true);
        }
        $devData = json_encode(array_filter([
            'name'      => $devName,
            'webdavUrl' => $devWebdav,
            'username'  => $devUser,
            'password'  => $devPass,
        ], fn($v) => $v !== ''));
        $devFile = $devicesDir . '/' . $devId . '.json';
        if (file_put_contents($devFile, $devData) !== false) {
            $devMessage     = 'Device credentials updated. The TV will pick up the change within 60 seconds.';
            $devMessageType = 'success';
        } else {
            $devMessage     = 'Failed to write device config. Check server permissions.';
            $devMessageType = 'error';
        }
    }
}

// List devices
$deviceFiles = is_dir($devicesDir) ? glob($devicesDir . '/*.json') : [];
?>

<hr style="margin: 40px 0;">
<h2>Manage Devices</h2>
<?php if ($devMessage): ?>
    <p class="<?= htmlspecialchars($devMessageType) ?>"><?= htmlspecialchars($devMessage) ?></p>
<?php endif; ?>
<?php if (empty($deviceFiles)): ?>
    <p>No registered devices yet. Devices appear here after their first pairing.</p>
<?php else: ?>
    <?php foreach ($deviceFiles as $devFile):
        $uuid    = basename($devFile, '.json');
        $mtime   = date('Y-m-d H:i:s', filemtime($devFile));
        $devCfg  = json_decode(file_get_contents($devFile), true) ?: [];
        $devName = $devCfg['name']      ?? '';
        $devUrl  = $devCfg['webdavUrl'] ?? '';
        $devUser = $devCfg['username']  ?? '';
        $label   = $devName !== '' ? $devName : $uuid;
    ?>
    <details style="margin-top: 20px; border: 1px solid #ccc; padding: 12px;">
        <summary style="cursor: pointer; font-weight: bold;">
            <?= htmlspecialchars($label) ?> &mdash; last updated <?= htmlspecialchars($mtime) ?>
        </summary>
        <form method="post" action="" style="margin-top: 12px;">
            <input type="hidden" name="device" value="<?= htmlspecialchars($uuid) ?>">

            <label for="dev_name_<?= htmlspecialchars($uuid) ?>">Device Name</label>
            <input type="text" id="dev_name_<?= htmlspecialchars($uuid) ?>" name="dev_name"
                   value="<?= htmlspecialchars($devName) ?>" placeholder="e.g. Lobby TV">

            <label for="dev_webdavUrl_<?= htmlspecialchars($uuid) ?>">WebDAV URL</label>
            <input type="url" id="dev_webdavUrl_<?= htmlspecialchars($uuid) ?>" name="dev_webdavUrl"
                   value="<?= htmlspecialchars($devUrl) ?>" required>

            <label for="dev_username_<?= htmlspecialchars($uuid) ?>">Username</label>
            <input type="text" id="dev_username_<?= htmlspecialchars($uuid) ?>" name="dev_username"
                   value="<?= htmlspecialchars($devUser) ?>" required>

            <label for="dev_password_<?= htmlspecialchars($uuid) ?>">New Password</label>
            <input type="password" id="dev_password_<?= htmlspecialchars($uuid) ?>" name="dev_password"
                   placeholder="Enter new password" required>

            <button type="submit" style="margin-top: 12px;">Update Credentials</button>
        </form>
    </details>
    <?php endforeach; ?>
<?php endif; ?>
</body>
</html>
