<?php
declare(strict_types=1);

namespace EonBrain\Connector;

/**
 * Generic database connector over PDO. Supports sqlite / mysql / pgsql out of
 * the box from a single config block. Lazily connects, and only ever issues
 * SELECTs against the source (read-only).
 */
final class PdoConnector implements ConnectorInterface
{
    private ?\PDO $pdo = null;

    public function __construct(private array $cfg) {}

    public function driver(): string
    {
        return strtolower((string)($this->cfg['driver'] ?? 'sqlite'));
    }

    public function pdo(): \PDO
    {
        if ($this->pdo instanceof \PDO) {
            return $this->pdo;
        }
        $driver = $this->driver();
        $opts = [
            \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        if ($driver === 'sqlite') {
            $path = (string)$this->cfg['database'];
            $this->pdo = new \PDO('sqlite:' . $path, null, null, $opts);
        } elseif ($driver === 'mysql') {
            $dsn = sprintf(
                'mysql:host=%s;port=%s;dbname=%s;charset=%s',
                $this->cfg['host'] ?? '127.0.0.1',
                $this->cfg['port'] ?? 3306,
                $this->cfg['database'],
                $this->cfg['charset'] ?? 'utf8mb4'
            );
            $this->pdo = new \PDO($dsn, $this->cfg['username'] ?? null, $this->cfg['password'] ?? null, $opts);
        } elseif ($driver === 'pgsql') {
            $dsn = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s',
                $this->cfg['host'] ?? '127.0.0.1',
                $this->cfg['port'] ?? 5432,
                $this->cfg['database']
            );
            $this->pdo = new \PDO($dsn, $this->cfg['username'] ?? null, $this->cfg['password'] ?? null, $opts);
        } else {
            throw new \RuntimeException("Unsupported source driver: {$driver}");
        }
        return $this->pdo;
    }

    public function select(string $sql, array $params = []): array
    {
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function quoteIdent(string $ident): string
    {
        // Only ever called with identifiers that were discovered from the
        // source's own catalog (whitelisted), but we still hard-sanitise.
        $clean = preg_replace('/[^A-Za-z0-9_]/', '', $ident) ?? '';
        return match ($this->driver()) {
            'mysql' => '`' . $clean . '`',
            default => '"' . $clean . '"',   // pgsql + sqlite
        };
    }

    /** The database name (used as a schema filter in discovery). */
    public function databaseName(): string
    {
        return (string)($this->cfg['database'] ?? '');
    }
}
