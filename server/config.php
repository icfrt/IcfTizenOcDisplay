<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$code = $_GET['code'] ?? '';

// Validate: exactly 6 chars from the TV's pairing alphabet (no 0/1/I/L/O)
if (!preg_match('/^[A-HJKMNP-Z2-9]{6}$/', $code)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid code format']);
    exit;
}

$file = __DIR__ . '/configs/' . $code . '.json';

if (!file_exists($file)) {
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
    exit;
}

$data = file_get_contents($file);
$config = json_decode($data, true);

if (!$config || !isset($config['webdavUrl'], $config['username'], $config['password'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Invalid config data']);
    exit;
}

// Delete the file after a successful read so credentials don't sit on disk indefinitely.
// The TV has already stored the config in localStorage at this point.
unlink($file);

echo $data;
