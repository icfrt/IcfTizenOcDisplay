<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$code     = $_GET['code']   ?? '';
$deviceId = $_GET['device'] ?? '';

// Validate UUID format if provided (prevents path traversal)
if ($deviceId !== '' && !preg_match('/^[0-9a-f\-]{36}$/', $deviceId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid device ID format']);
    exit;
}

$devicesDir = __DIR__ . '/devices';

// ── Device-only lookup: ?device=UUID ──────────────────────────────────────────
if ($deviceId !== '' && $code === '') {
    $devFile = $devicesDir . '/' . $deviceId . '.json';
    if (!file_exists($devFile)) {
        http_response_code(404);
        echo json_encode(['error' => 'Not found']);
        exit;
    }
    $data   = file_get_contents($devFile);
    $config = json_decode($data, true);
    if (!$config || !isset($config['webdavUrl'], $config['username'], $config['password'])) {
        http_response_code(500);
        echo json_encode(['error' => 'Invalid config data']);
        exit;
    }
    echo $data;
    exit;
}

// ── Code-based lookup (pairing): ?code=CODE[&device=UUID] ─────────────────────
if (!preg_match('/^[A-HJKMNP-Z2-9]{6}$/', $code)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid code format']);
    exit;
}

$codeFile = __DIR__ . '/configs/' . $code . '.json';

if (!file_exists($codeFile)) {
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
    exit;
}

$data   = file_get_contents($codeFile);
$config = json_decode($data, true);

if (!$config || !isset($config['webdavUrl'], $config['username'], $config['password'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Invalid config data']);
    exit;
}

// Persist config to devices/{UUID}.json for future credential-update polling
if ($deviceId !== '') {
    if (!is_dir($devicesDir)) {
        mkdir($devicesDir, 0700, true);
    }
    file_put_contents($devicesDir . '/' . $deviceId . '.json', $data);
}

// Delete the code file — one-time-use, credentials must not linger on disk
unlink($codeFile);

echo $data;
