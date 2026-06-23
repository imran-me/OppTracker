<?php
/**
 * EON — Future AI endpoints (roadmap scaffold).
 *
 * This is the single entry point reserved for Phases 2-6:
 *   Phase 2: Voice interaction
 *   Phase 3: Memory system (semantic recall)
 *   Phase 4: Workflow learning
 *   Phase 5: Personalized assistance
 *   Phase 6: Full AI coworker
 *
 * It already speaks the contract the front-end ai-core.js expects, so wiring a
 * real LLM later means filling in one function — no front-end changes.
 *
 * Usage (front-end): POST { intent, message, context } -> { ok, reply, emotion }
 */

require_once __DIR__ . '/../php/memory-manager.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    eon_respond([
        'ok'      => true,
        'service' => 'EON AI',
        'status'  => 'stub',
        'phases'  => [
            'voice'        => 'planned',
            'memory'       => 'planned',
            'workflow'     => 'planned',
            'personalized' => 'planned',
            'coworker'     => 'planned',
        ],
    ]);
}

$body    = eon_json_body();
$intent  = (string)($body['intent']  ?? 'chat');
$message = (string)($body['message'] ?? '');
$context = $body['context'] ?? [];

/**
 * Placeholder "brain". Replace this body with a call to your LLM provider.
 * Keep the return shape identical so the front-end keeps working.
 *
 * Example (pseudo):
 *   $reply = Anthropic::messages($message, $context);
 */
function eon_think(string $intent, string $message, array $context): array
{
    $canned = [
        'Still learning — but I am listening. 🌱',
        'Got it. I will remember that as my brain grows.',
        'One day I will answer that fully. For now, I am here with you.',
    ];
    $reply = $canned[abs(crc32($message)) % count($canned)];

    return ['reply' => $reply, 'emotion' => 'curious'];
}

$result = eon_think($intent, $message, $context);

eon_respond([
    'ok'      => true,
    'intent'  => $intent,
    'reply'   => $result['reply'],
    'emotion' => $result['emotion'],
]);
