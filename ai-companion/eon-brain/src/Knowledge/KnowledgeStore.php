<?php
declare(strict_types=1);

namespace EonBrain\Knowledge;

use EonBrain\Storage\BrainStore;

/**
 * EON's normalized long-term memory — independent of any source system's
 * structure. Every learned record lands here as (source, table, record_id,
 * label, deadline_at, payload_json). Phase 1 uses label + deadline_at, but
 * payload_json holds the FULL row so future skills read the same memory.
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │ FUTURE-SKILL HOOK:                                                   │
 *  │ New helping features (suggestions, mistake-catching, analysis, …)   │
 *  │ should READ from here via records()/query() — they never re-read    │
 *  │ the source. Add new derived outputs as their own eon_* tables.      │
 *  └─────────────────────────────────────────────────────────────────────┘
 */
final class KnowledgeStore
{
    public function __construct(private BrainStore $store) {}

    /** Register/refresh a connected source; returns its id. */
    public function registerSource(string $name, string $driver): int
    {
        $row = $this->store->one('SELECT id FROM eon_sources WHERE name = :n', [':n' => $name]);
        if ($row) {
            $this->store->run('UPDATE eon_sources SET driver = :d WHERE id = :id', [':d' => $driver, ':id' => $row['id']]);
            return (int)$row['id'];
        }
        $this->store->run(
            'INSERT INTO eon_sources (name, driver, created_at) VALUES (:n, :d, :t)',
            [':n' => $name, ':d' => $driver, ':t' => gmdate('c')]
        );
        return (int)$this->store->pdo()->lastInsertId();
    }

    public function markSourceLearned(int $sourceId): void
    {
        $this->store->run('UPDATE eon_sources SET last_learned_at = :t WHERE id = :id', [':t' => gmdate('c'), ':id' => $sourceId]);
    }

    /** Persist (upsert) a discovered table descriptor. */
    public function saveTableMap(int $sourceId, array $desc): void
    {
        $existing = $this->store->one(
            'SELECT id FROM eon_tables WHERE source_id = :s AND table_name = :t',
            [':s' => $sourceId, ':t' => $desc['table']]
        );
        $cols = json_encode($desc['columns'] ?? [], JSON_UNESCAPED_SLASHES);
        $rels = json_encode($desc['relations'] ?? [], JSON_UNESCAPED_SLASHES);
        if ($existing) {
            $this->store->run(
                'UPDATE eon_tables SET label_column=:l, deadline_column=:d, updated_column=:u, pk_column=:p,
                 link_pattern=:lp, columns_json=:c, relations_json=:r WHERE id=:id',
                [':l' => $desc['label_column'], ':d' => $desc['deadline_column'], ':u' => $desc['updated_column'],
                 ':p' => $desc['pk_column'], ':lp' => $desc['link_pattern'], ':c' => $cols, ':r' => $rels, ':id' => $existing['id']]
            );
        } else {
            $this->store->run(
                'INSERT INTO eon_tables (source_id, table_name, label_column, deadline_column, updated_column,
                 pk_column, link_pattern, columns_json, relations_json) VALUES (:s,:t,:l,:d,:u,:p,:lp,:c,:r)',
                [':s' => $sourceId, ':t' => $desc['table'], ':l' => $desc['label_column'], ':d' => $desc['deadline_column'],
                 ':u' => $desc['updated_column'], ':p' => $desc['pk_column'], ':lp' => $desc['link_pattern'],
                 ':c' => $cols, ':r' => $rels]
            );
        }
    }

    /** @return array<int,array> stored table maps for a source */
    public function tableMaps(int $sourceId): array
    {
        return $this->store->all('SELECT * FROM eon_tables WHERE source_id = :s', [':s' => $sourceId]);
    }

    public function tableLastLearned(int $sourceId, string $table): ?string
    {
        $row = $this->store->one(
            'SELECT last_learned_at FROM eon_tables WHERE source_id = :s AND table_name = :t',
            [':s' => $sourceId, ':t' => $table]
        );
        return $row['last_learned_at'] ?? null;
    }

    public function markTableLearned(int $sourceId, string $table): void
    {
        $this->store->run(
            'UPDATE eon_tables SET last_learned_at = :t WHERE source_id = :s AND table_name = :tab',
            [':t' => gmdate('c'), ':s' => $sourceId, ':tab' => $table]
        );
    }

    /** Upsert one learned record into normalized memory. */
    public function remember(int $sourceId, string $table, string $recordId, ?string $label, ?string $deadlineAt, array $payload): void
    {
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $existing = $this->store->one(
            'SELECT id FROM eon_knowledge WHERE source_id=:s AND table_name=:t AND record_id=:r',
            [':s' => $sourceId, ':t' => $table, ':r' => $recordId]
        );
        if ($existing) {
            $this->store->run(
                'UPDATE eon_knowledge SET label=:l, deadline_at=:d, payload_json=:p, learned_at=:t WHERE id=:id',
                [':l' => $label, ':d' => $deadlineAt, ':p' => $json, ':t' => gmdate('c'), ':id' => $existing['id']]
            );
        } else {
            $this->store->run(
                'INSERT INTO eon_knowledge (source_id, table_name, record_id, label, deadline_at, payload_json, learned_at)
                 VALUES (:s,:t,:r,:l,:d,:p,:lt)',
                [':s' => $sourceId, ':t' => $table, ':r' => $recordId, ':l' => $label, ':d' => $deadlineAt,
                 ':p' => $json, ':lt' => gmdate('c')]
            );
        }
    }

    /** Records carrying a deadline within [now-grace, now+horizon] days. */
    public function upcomingDeadlines(int $sourceId, int $horizonDays, int $graceDays = 30): array
    {
        $from = gmdate('c', time() - $graceDays * 86400);
        $to   = gmdate('c', time() + $horizonDays * 86400);
        return $this->store->all(
            "SELECT * FROM eon_knowledge
             WHERE source_id = :s AND deadline_at IS NOT NULL AND deadline_at <> ''
               AND deadline_at >= :from AND deadline_at <= :to
             ORDER BY deadline_at ASC",
            [':s' => $sourceId, ':from' => $from, ':to' => $to]
        );
    }

    /** General read for future skills (filter by table, limit). */
    public function records(int $sourceId, ?string $table = null, int $limit = 500): array
    {
        if ($table) {
            return $this->store->all(
                'SELECT * FROM eon_knowledge WHERE source_id=:s AND table_name=:t ORDER BY learned_at DESC LIMIT :l',
                [':s' => $sourceId, ':t' => $table, ':l' => $limit]
            );
        }
        return $this->store->all(
            'SELECT * FROM eon_knowledge WHERE source_id=:s ORDER BY learned_at DESC LIMIT :l',
            [':s' => $sourceId, ':l' => $limit]
        );
    }
}
