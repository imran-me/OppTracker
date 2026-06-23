<?php
declare(strict_types=1);

namespace EonBrain\Storage;

/**
 * EON's PRIVATE store. EON writes ONLY here — never to the connected system.
 * Creates and owns the `eon_*` tables (its migrations). Defaults to a SQLite
 * file so the source DB is physically separate and untouchable.
 */
final class BrainStore
{
    private \PDO $pdo;

    public function __construct(array $cfg)
    {
        $driver = strtolower((string)($cfg['driver'] ?? 'sqlite'));
        $opts = [
            \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ];
        if ($driver === 'sqlite') {
            $path = (string)$cfg['database'];
            $dir = dirname($path);
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            $this->pdo = new \PDO('sqlite:' . $path, null, null, $opts);
            $this->pdo->exec('PRAGMA journal_mode=WAL');
        } elseif ($driver === 'mysql') {
            $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                $cfg['host'] ?? '127.0.0.1', $cfg['port'] ?? 3306, $cfg['database']);
            $this->pdo = new \PDO($dsn, $cfg['username'] ?? null, $cfg['password'] ?? null, $opts);
        } else {
            throw new \RuntimeException("Unsupported brain store driver: {$driver}");
        }
        $this->migrate();
    }

    public function pdo(): \PDO { return $this->pdo; }

    public function run(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row ?: null;
    }

    /** Create EON's own tables. Idempotent. Only eon_* tables, ever. */
    private function migrate(): void
    {
        $isSqlite = $this->pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $auto = $isSqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT AUTO_INCREMENT PRIMARY KEY';

        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_sources (
            id $auto,
            name TEXT, driver TEXT,
            last_learned_at TEXT, created_at TEXT
        )");

        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_tables (
            id $auto,
            source_id INTEGER, table_name TEXT,
            label_column TEXT, deadline_column TEXT, updated_column TEXT,
            pk_column TEXT, link_pattern TEXT,
            columns_json TEXT, relations_json TEXT,
            last_learned_at TEXT
        )");
        $this->pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_eon_tables ON eon_tables(source_id, table_name)");

        // General-purpose normalized memory. Future skills read from payload_json.
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_knowledge (
            id $auto,
            source_id INTEGER, table_name TEXT, record_id TEXT,
            label TEXT, deadline_at TEXT,
            payload_json TEXT, learned_at TEXT
        )");
        $this->pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_eon_knowledge ON eon_knowledge(source_id, table_name, record_id)");
        $this->pdo->exec("CREATE INDEX IF NOT EXISTS ix_eon_knowledge_deadline ON eon_knowledge(deadline_at)");

        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_alerts (
            id $auto,
            type TEXT, source_id INTEGER, table_name TEXT, record_id TEXT,
            label TEXT, due_at TEXT, urgency TEXT, point_to TEXT,
            dedup_key TEXT, status TEXT, snooze_until TEXT,
            created_at TEXT, updated_at TEXT
        )");
        $this->pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_eon_alerts ON eon_alerts(dedup_key)");
        $this->pdo->exec("CREATE INDEX IF NOT EXISTS ix_eon_alerts_status ON eon_alerts(status)");

        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_reminders (
            id $auto,
            title TEXT, note TEXT, remind_at TEXT, link TEXT,
            status TEXT, created_at TEXT
        )");

        $this->pdo->exec("CREATE TABLE IF NOT EXISTS eon_state (
            id INTEGER PRIMARY KEY,
            state TEXT, progress REAL, section TEXT,
            message TEXT, point_to TEXT,
            insight_until TEXT, last_cycle_at TEXT, updated_at TEXT
        )");
        if (!$this->one('SELECT id FROM eon_state WHERE id = 1')) {
            $this->run(
                "INSERT INTO eon_state (id, state, progress, updated_at) VALUES (1, 'idle', 0, :t)",
                [':t' => gmdate('c')]
            );
        }
    }
}
