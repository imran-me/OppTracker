<?php
declare(strict_types=1);

namespace EonBrain\Discovery;

use EonBrain\Connector\PdoConnector;

/**
 * Inspects a connected system and builds EON's MAP of it — every table, its
 * columns/types, relationships, and the auto-detected deadline / label /
 * updated / primary-key columns. Works without any manual table list.
 *
 * Supported catalogs: SQLite (PRAGMA) and MySQL/Postgres (information_schema).
 */
final class SchemaDiscovery
{
    /** date-ish column-name hints, strongest first. */
    private const DEADLINE_HINTS = [
        'deadline', 'due_date', 'due', 'expiry', 'expiry_date', 'expire', 'expires',
        'expires_at', 'valid_till', 'valid_until', 'renewal', 'renew', 'end_date',
        'ends_at', 'end', 'close_date', 'target_date', 'remind_at', 'remind',
    ];
    private const LABEL_HINTS   = ['name', 'title', 'label', 'subject', 'reference', 'ref', 'code'];
    private const UPDATED_HINTS = ['updated_at', 'updatedat', 'modified_at', 'modified', 'changed_at', 'last_modified', 'updated'];

    public function __construct(
        private PdoConnector $conn,
        private array $cfg = []
    ) {}

    /** @return array<string,array> map of table => descriptor */
    public function discover(): array
    {
        $only = (array)($this->cfg['source']['only_tables'] ?? []);
        $skip = (array)($this->cfg['source']['skip_tables'] ?? []);
        $overrides = (array)($this->cfg['overrides'] ?? []);

        $map = [];
        foreach ($this->tables() as $table) {
            if ($only && !in_array($table, $only, true)) {
                continue;
            }
            if (in_array($table, $skip, true)) {
                continue;
            }
            $columns = $this->columns($table);          // [name => ['type'=>..,'is_date'=>bool,'pk'=>bool]]
            if (!$columns) {
                continue;
            }
            $desc = [
                'table'           => $table,
                'columns'         => $columns,
                'relations'       => $this->relations($table),
                'pk_column'       => $this->detectPk($columns),
                'deadline_column' => $this->detectByHints($columns, self::DEADLINE_HINTS, true),
                'label_column'    => $this->detectByHints($columns, self::LABEL_HINTS, false),
                'updated_column'  => $this->detectByHints($columns, self::UPDATED_HINTS, true),
                'link_pattern'    => (string)($this->cfg['link_pattern'] ?? '?table={table}&id={id}'),
            ];

            // apply manual overrides if provided
            if (isset($overrides[$table])) {
                $o = $overrides[$table];
                $desc['deadline_column'] = $o['deadline_column'] ?? $desc['deadline_column'];
                $desc['label_column']    = $o['label_column']    ?? $desc['label_column'];
                $desc['link_pattern']    = $o['link_pattern']    ?? $desc['link_pattern'];
            }
            $map[$table] = $desc;
        }
        return $map;
    }

    // ---------------------------------------------------------------
    private function driver(): string { return $this->conn->driver(); }

    /** @return string[] */
    private function tables(): array
    {
        if ($this->driver() === 'sqlite') {
            $rows = $this->conn->select(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'eon_%' ORDER BY name"
            );
            return array_map(static fn ($r) => (string)$r['name'], $rows);
        }
        $schema = $this->schema();
        $rows = $this->conn->select(
            "SELECT table_name FROM information_schema.tables
             WHERE table_schema = :s AND table_type = 'BASE TABLE'
             AND table_name NOT LIKE 'eon\\_%' ORDER BY table_name",
            [':s' => $schema]
        );
        return array_map(static fn ($r) => (string)($r['table_name'] ?? $r['TABLE_NAME']), $rows);
    }

    /** @return array<string,array> column => meta */
    private function columns(string $table): array
    {
        $out = [];
        if ($this->driver() === 'sqlite') {
            $rows = $this->conn->select('PRAGMA table_info(' . $this->conn->quoteIdent($table) . ')');
            foreach ($rows as $r) {
                $type = strtolower((string)($r['type'] ?? ''));
                $out[(string)$r['name']] = [
                    'type'    => $type,
                    'is_date' => $this->isDateType($type, (string)$r['name']),
                    'pk'      => (int)($r['pk'] ?? 0) > 0,
                ];
            }
            return $out;
        }
        $schema = $this->schema();
        $rows = $this->conn->select(
            "SELECT column_name, data_type, column_key
             FROM information_schema.columns
             WHERE table_schema = :s AND table_name = :t",
            [':s' => $schema, ':t' => $table]
        );
        foreach ($rows as $r) {
            $name = (string)($r['column_name'] ?? $r['COLUMN_NAME']);
            $type = strtolower((string)($r['data_type'] ?? $r['DATA_TYPE'] ?? ''));
            $key  = strtoupper((string)($r['column_key'] ?? $r['COLUMN_KEY'] ?? ''));
            $out[$name] = [
                'type'    => $type,
                'is_date' => $this->isDateType($type, $name),
                'pk'      => $key === 'PRI',
            ];
        }
        return $out;
    }

    /** @return array<int,array{column:string,ref_table:string,ref_column:string}> */
    private function relations(string $table): array
    {
        $rels = [];
        if ($this->driver() === 'sqlite') {
            $rows = $this->conn->select('PRAGMA foreign_key_list(' . $this->conn->quoteIdent($table) . ')');
            foreach ($rows as $r) {
                $rels[] = ['column' => (string)$r['from'], 'ref_table' => (string)$r['table'], 'ref_column' => (string)$r['to']];
            }
            return $rels;
        }
        try {
            $schema = $this->schema();
            $rows = $this->conn->select(
                "SELECT column_name, referenced_table_name, referenced_column_name
                 FROM information_schema.key_column_usage
                 WHERE table_schema = :s AND table_name = :t AND referenced_table_name IS NOT NULL",
                [':s' => $schema, ':t' => $table]
            );
            foreach ($rows as $r) {
                $rels[] = [
                    'column'     => (string)($r['column_name'] ?? ''),
                    'ref_table'  => (string)($r['referenced_table_name'] ?? ''),
                    'ref_column' => (string)($r['referenced_column_name'] ?? ''),
                ];
            }
        } catch (\Throwable) {
            // pgsql lacks the MySQL referenced_* columns; relations are optional.
        }
        return $rels;
    }

    private function schema(): string
    {
        if ($this->driver() === 'pgsql') {
            return 'public';
        }
        // mysql: schema == database name
        return (string)($this->cfg['source']['database'] ?? '');
    }

    private function isDateType(string $type, string $name): bool
    {
        if (preg_match('/date|time|timestamp/', $type)) {
            return true;
        }
        // SQLite is loosely typed: trust the name for date-ish columns.
        if ($type === '' || preg_match('/int|text|char|num|real|blob/', $type)) {
            return (bool)preg_match('/(_at$|_date$|date|deadline|due|expir|renew|valid_till|valid_until)/i', $name);
        }
        return false;
    }

    private function detectPk(array $columns): string
    {
        foreach ($columns as $name => $meta) {
            if ($meta['pk']) {
                return $name;
            }
        }
        return isset($columns['id']) ? 'id' : (string)array_key_first($columns);
    }

    /**
     * Pick the best column whose name matches one of the hints (in priority
     * order). When $mustBeDate, only date-typed columns qualify.
     */
    private function detectByHints(array $columns, array $hints, bool $mustBeDate): ?string
    {
        foreach ($hints as $hint) {
            foreach ($columns as $name => $meta) {
                if ($mustBeDate && !$meta['is_date']) {
                    continue;
                }
                if (str_contains(strtolower($name), $hint)) {
                    return $name;
                }
            }
        }
        return null;
    }
}
