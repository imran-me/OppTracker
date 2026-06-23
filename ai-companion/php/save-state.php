<?php
/**
 * EON — POST /php/save-state.php
 * Body: { "key": "user-123", "state": { ... } }
 * Persists EON's state (mood, position, memory, activity history).
 */

require_once __DIR__ . '/memory-manager.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    eon_respond(['ok' => false, 'error' => 'POST required'], 405);
}

$body  = eon_json_body();
$key   = (string)($body['key'] ?? 'default');
$state = $body['state'] ?? null;

if (!is_array($state)) {
    eon_respond(['ok' => false, 'error' => 'Missing state object'], 400);
}

$mem = new EonMemory($EON_CONFIG);
$ok  = $mem->save($key, $state);

eon_respond([
    'ok'        => $ok,
    'savedAt'   => gmdate('c'),
    'key'       => $key,
]);
