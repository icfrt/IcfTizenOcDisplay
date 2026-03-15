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
</body>
</html>
