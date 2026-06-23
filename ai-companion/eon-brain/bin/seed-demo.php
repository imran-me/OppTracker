<?php
declare(strict_types=1);

/**
 * Creates a throwaway SQLite "source system" so you can see EON learn end-to-end
 * without wiring a real database. Safe to delete storage/demo-source.sqlite anytime.
 *
 *   php bin/seed-demo.php
 */

$path = __DIR__ . '/../storage/demo-source.sqlite';
@mkdir(dirname($path), 0775, true);
@unlink($path);

$pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// A typical business table — note the date column EON should auto-detect.
$pdo->exec("CREATE TABLE opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    organizer TEXT,
    deadline_date DATE,
    updated_at TEXT
)");

$insert = $pdo->prepare("INSERT INTO opportunities (name, organizer, deadline_date, updated_at) VALUES (?,?,?,?)");
$today = time();
$rows = [
    ['Chevening Scholarship',  'UK Govt',      gmdate('Y-m-d', $today + 2 * 86400)],   // 2 days away
    ['Hackathon Final',        'Epal Group',   gmdate('Y-m-d', $today + 6 * 86400)],   // 6 days away
    ['Tax Filing',             'NBR',          gmdate('Y-m-d', $today - 1 * 86400)],   // overdue
    ['Conference (far off)',   'IEEE',         gmdate('Y-m-d', $today + 40 * 86400)],  // outside windows
];
foreach ($rows as $r) {
    $insert->execute([$r[0], $r[1], $r[2], gmdate('c')]);
}

// A second table with a different date-column name, to prove auto-detection generalises.
$pdo->exec("CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    expiry_date DATE,
    updated_at TEXT
)");
$pdo->prepare("INSERT INTO documents (title, expiry_date, updated_at) VALUES (?,?,?)")
    ->execute(['Passport', gmdate('Y-m-d', $today + 1 * 86400), gmdate('c')]);   // 1 day away

fwrite(STDOUT, "Seeded demo source at: $path\n");
fwrite(STDOUT, "Tables: opportunities (deadline_date), documents (expiry_date)\n");
