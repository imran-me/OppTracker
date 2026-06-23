<?php
/**
 * EON — EPAL AI Companion
 * Central configuration.
 *
 * Returns JSON when requested directly (the front-end fetches this), and also
 * exposes a $EON_CONFIG array when included by other PHP scripts.
 *
 * NOTE: The front-end has an identical DEFAULTS block in js/main.js, so the
 * companion works perfectly even when PHP is unavailable (e.g. static hosting).
 */

$EON_CONFIG = [
    'version'      => '1.0.0',
    'name'         => 'EON',
    'fullName'     => 'Evolution Of Networked Intelligence',

    // Where persisted state lives when PHP IS available.
    // Relative to this file. Must be writable by the web server.
    'storageDir'   => __DIR__ . '/../assets/.state',

    // Behaviour timing (milliseconds).
    'idle' => [
        'goHome'    => 5  * 60 * 1000,   // 5 min  -> walk home
        'activity'  => 10 * 60 * 1000,   // 10 min -> tea / tv / read
        'sleep'     => 20 * 60 * 1000,   // 20 min -> sleep
    ],

    // How often the "random life" tick may trigger an activity (ms).
    'lifeTick'     => 45 * 1000,

    // Official palette — keep green vibrant and EON never mostly black.
    'palette' => [
        'ocean'  => '#1f6dff',
        'blue'   => '#2f8bff',
        'cyan'   => '#28c7d8',
        'lime'   => '#7ed957',
        'navy'   => '#10225e',
        'violet' => '#7b54e0',
        'purple' => '#b08ff0',
        'white'  => '#eef4ff',
    ],

    // Toggle subsystems without touching code.
    'features' => [
        'pet'        => false,
        'home'       => false,
        'speech'     => true,
        'particles'  => true,
        'dayNight'   => true,
        'sound'      => false, // off by default — opt-in to avoid surprising users
    ],
];

// When called directly over HTTP, emit JSON for the front-end loader.
if (php_sapi_name() !== 'cli' && basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'settings.php') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    // Never leak the absolute server path to the client.
    $public = $EON_CONFIG;
    unset($public['storageDir']);
    echo json_encode($public, JSON_UNESCAPED_SLASHES);
    exit;
}
