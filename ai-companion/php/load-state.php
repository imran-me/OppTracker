<?php
/**
 * EON — GET /php/load-state.php?key=user-123
 * Returns the persisted state for a key, or an empty object.
 */

require_once __DIR__ . '/memory-manager.php';

$key = (string)($_GET['key'] ?? 'default');

$mem   = new EonMemory($EON_CONFIG);
$state = $mem->load($key);

eon_respond([
    'ok'    => true,
    'key'   => $key,
    'state' => $state ?? new stdClass(),
    'found' => $state !== null,
]);
