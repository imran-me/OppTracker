<?php
/**
 * EON — memory manager (shared helper for save/load).
 *
 * File-based JSON store. One file per user key. No database required.
 * This is intentionally tiny and dependency-free so it drops into any PHP host.
 */

require_once __DIR__ . '/../config/settings.php';

class EonMemory
{
    private string $dir;

    public function __construct(array $config)
    {
        $this->dir = $config['storageDir'];
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
    }

    /** Sanitise a user-supplied key into a safe filename. */
    private function path(string $key): string
    {
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $key);
        if ($safe === '') {
            $safe = 'default';
        }
        return $this->dir . '/eon-' . $safe . '.json';
    }

    /** Load state for a key, or null if none stored. */
    public function load(string $key): ?array
    {
        $file = $this->path($key);
        if (!is_file($file)) {
            return null;
        }
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    /** Persist state for a key. Returns true on success. */
    public function save(string $key, array $state): bool
    {
        // Merge over existing so partial updates don't wipe memory.
        $existing = $this->load($key) ?? [];
        $merged   = array_replace_recursive($existing, $state);
        $merged['_updatedAt'] = gmdate('c');

        $file = $this->path($key);
        // Atomic-ish write via temp file + rename.
        $tmp = $file . '.tmp';
        $ok  = @file_put_contents($tmp, json_encode($merged, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        if ($ok === false) {
            return false;
        }
        return @rename($tmp, $file);
    }
}

/** Read and decode a JSON request body. */
function eon_json_body(): array
{
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Standard JSON response + CORS for same-origin/dev use. */
function eon_respond(array $payload, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}
