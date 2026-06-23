<?php
declare(strict_types=1);

/**
 * EON Brain — HTTP API consumed by the avatar.
 *
 * Routes (via PATH_INFO, e.g. api/index.php/state, or rewritten /eon/state):
 *   GET  /state                     → learning state + progress (meditation UI)
 *   GET  /alerts                    → active alerts/reminders, urgency-sorted
 *   POST /alerts/{id}/seen
 *   POST /alerts/{id}/snooze        body: { "minutes": 30 }
 *   POST /alerts/{id}/dismiss
 *   POST /reminders                 body: { title, note?, remind_at, link? }
 *   POST /meditate                  → run one cycle now (handy for the avatar)
 *   GET  /discover                  → current schema map (debug)
 */

require __DIR__ . '/../bootstrap.php';

use EonBrain\Support\Json;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    Json::send(['ok' => true]);
}

$brain = eon_brain();

$path = trim((string)($_SERVER['PATH_INFO'] ?? ''), '/');
$parts = $path === '' ? [] : explode('/', $path);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // GET /state
    if ($method === 'GET' && ($parts[0] ?? '') === 'state') {
        Json::send(['ok' => true, 'state' => $brain->state()]);
    }

    // GET /alerts
    if ($method === 'GET' && ($parts[0] ?? '') === 'alerts' && !isset($parts[1])) {
        Json::send(['ok' => true, 'alerts' => $brain->alerts()]);
    }

    // POST /alerts/{id}/{action}
    if ($method === 'POST' && ($parts[0] ?? '') === 'alerts' && isset($parts[1], $parts[2])) {
        $id = $parts[1];
        $action = $parts[2];
        $ok = match ($action) {
            'seen'    => $brain->markSeen($id),
            'dismiss' => $brain->dismiss($id),
            'snooze'  => $brain->snooze($id, (int)(Json::body()['minutes'] ?? 30)),
            default   => null,
        };
        if ($ok === null) {
            Json::send(['ok' => false, 'error' => 'Unknown action'], 400);
        }
        Json::send(['ok' => $ok, 'id' => $id, 'action' => $action]);
    }

    // POST /reminders
    if ($method === 'POST' && ($parts[0] ?? '') === 'reminders') {
        $b = Json::body();
        if (empty($b['title']) || empty($b['remind_at'])) {
            Json::send(['ok' => false, 'error' => 'title and remind_at are required'], 400);
        }
        $r = $brain->createReminder((string)$b['title'], $b['note'] ?? null, (string)$b['remind_at'], $b['link'] ?? null);
        Json::send(['ok' => true, 'reminder' => $r], 201);
    }

    // POST /meditate  (run a cycle now)
    if ($method === 'POST' && ($parts[0] ?? '') === 'meditate') {
        Json::send(['ok' => true, 'result' => $brain->meditate()]);
    }

    // GET /discover  (debug: schema map)
    if ($method === 'GET' && ($parts[0] ?? '') === 'discover') {
        Json::send(['ok' => true, 'map' => $brain->connect()]);
    }

    Json::send(['ok' => false, 'error' => 'Not found', 'path' => $path], 404);
} catch (\Throwable $e) {
    Json::send(['ok' => false, 'error' => $e->getMessage()], 500);
}
