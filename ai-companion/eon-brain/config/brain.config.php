<?php
declare(strict_types=1);

/**
 * EON Brain configuration.
 * Everything is configurable here — connecting EON to a new system is just
 * editing the `source` block. Nothing about a specific app is hardcoded in code.
 *
 * Values can be overridden by environment variables (EON_*) so secrets stay
 * out of the file when deployed.
 */

$env = static fn (string $k, $default = null) => getenv($k) !== false ? getenv($k) : $default;

return [
    // ── The system EON connects to and LEARNS (READ-ONLY) ──
    // driver: 'sqlite' | 'mysql' | 'pgsql'. Provide a DSN or discrete parts.
    'source' => [
        'name'     => $env('EON_SOURCE_NAME', 'demo'),
        'driver'   => $env('EON_SOURCE_DRIVER', 'sqlite'),
        // sqlite: just a file path. mysql/pgsql: host/port/database/username/password.
        'database' => $env('EON_SOURCE_DB', __DIR__ . '/../storage/demo-source.sqlite'),
        'host'     => $env('EON_SOURCE_HOST', '127.0.0.1'),
        'port'     => $env('EON_SOURCE_PORT', null),
        'username' => $env('EON_SOURCE_USER', null),
        'password' => $env('EON_SOURCE_PASS', null),
        'charset'  => $env('EON_SOURCE_CHARSET', 'utf8mb4'),
        // optional: only learn these tables (empty = auto-discover all)
        'only_tables' => [],
        // optional: never read these tables
        'skip_tables' => [],
    ],

    // ── EON's OWN store (he ONLY ever writes here; never the source) ──
    // Defaults to a private SQLite file so the source DB is physically untouchable.
    'brain' => [
        'driver'   => $env('EON_BRAIN_DRIVER', 'sqlite'),
        'database' => $env('EON_BRAIN_DB', __DIR__ . '/../storage/eon-brain.sqlite'),
        'host'     => $env('EON_BRAIN_HOST', '127.0.0.1'),
        'port'     => $env('EON_BRAIN_PORT', null),
        'username' => $env('EON_BRAIN_USER', null),
        'password' => $env('EON_BRAIN_PASS', null),
    ],

    // ── Deadline warning windows, in days (descending). 0 = due today; overdue is implicit. ──
    'windows' => [7, 3, 1, 0],

    // ── One meditation cycle = learn → scan deadlines → raise reminders ──
    'interval_seconds' => 15 * 60,
    // small pause between sections so the avatar can *see* him read each one
    'meditation_pause_ms' => 250,
    // how long the "insight" state lingers after a cycle (for the avatar)
    'insight_linger_seconds' => 90,
    // read large tables in chunks of this many rows
    'chunk_size' => 1000,

    // ── Default link used to point the avatar at a record. Placeholders:
    //    {table} {id} {label}. Override per table below when needed. ──
    'link_pattern' => '?table={table}&id={id}',

    // ── Optional manual overrides when auto-detection needs correction. ──
    // 'table_name' => ['deadline_column'=>'due_on','label_column'=>'title','link_pattern'=>'opportunity-details.html?id={id}']
    'overrides' => [
        // 'opportunities' => ['link_pattern' => 'opportunity-details.html?id={id}'],
    ],
];
