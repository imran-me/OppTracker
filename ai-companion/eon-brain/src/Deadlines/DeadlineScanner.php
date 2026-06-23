<?php
declare(strict_types=1);

namespace EonBrain\Deadlines;

use EonBrain\Knowledge\KnowledgeStore;
use EonBrain\Storage\BrainStore;

/**
 * Scans EON's learned memory for records whose deadline falls inside the
 * configured warning windows, and raises/refreshes de-duplicated alerts —
 * each with a human label, urgency, and a `pointTo` link so the avatar can
 * float over and point at that exact record.
 */
final class DeadlineScanner
{
    public function __construct(
        private BrainStore $store,
        private KnowledgeStore $knowledge,
        private array $cfg
    ) {}

    public function scan(int $sourceId): int
    {
        $windows = $this->normalizedWindows();          // ascending, e.g. [0,1,3,7]
        $horizon = (int)(end($windows) ?: 7);
        $now = time();

        // table → link pattern (from discovery/overrides)
        $patterns = [];
        foreach ($this->knowledge->tableMaps($sourceId) as $m) {
            $patterns[(string)$m['table_name']] = (string)($m['link_pattern'] ?: '?table={table}&id={id}');
        }

        $raised = 0;
        foreach ($this->knowledge->upcomingDeadlines($sourceId, $horizon) as $rec) {
            $ts = strtotime((string)$rec['deadline_at']);
            if ($ts === false) {
                continue;
            }
            $days = (int)floor(($ts - $now) / 86400);
            [$urgency, $severity] = $this->classify($days, $windows);
            if ($urgency === null) {
                continue;   // outside all windows
            }

            $table  = (string)$rec['table_name'];
            $record = (string)$rec['record_id'];
            $label  = (string)($rec['label'] ?: ($table . ' #' . $record));
            $pointTo = $this->pointTo($patterns[$table] ?? '?table={table}&id={id}', $table, $record, $label);

            $this->upsertAlert([
                'type'      => 'deadline',
                'source_id' => $sourceId,
                'table'     => $table,
                'record'    => $record,
                'label'     => $label,
                'due_at'    => (string)$rec['deadline_at'],
                'urgency'   => $urgency,
                'severity'  => $severity,
                'point_to'  => $pointTo,
            ]);
            $raised++;
        }
        return $raised;
    }

    private function normalizedWindows(): array
    {
        $w = array_map('intval', (array)($this->cfg['windows'] ?? [7, 3, 1, 0]));
        $w = array_values(array_unique($w));
        sort($w);
        return $w ?: [0, 1, 3, 7];
    }

    /** @return array{0:?string,1:int} [urgencyLabel|null, severity] */
    private function classify(int $days, array $asc): array
    {
        if ($days < 0) {
            return ['overdue', count($asc) + 2];
        }
        foreach ($asc as $idx => $w) {
            if ($days <= $w) {
                $label = $w === 0 ? 'due-today' : ('within-' . $w . 'd');
                return [$label, count($asc) - $idx + 1];   // tighter window → higher severity
            }
        }
        return [null, 0];
    }

    private function pointTo(string $pattern, string $table, string $id, string $label): string
    {
        return strtr($pattern, [
            '{table}' => rawurlencode($table),
            '{id}'    => rawurlencode($id),
            '{label}' => rawurlencode($label),
        ]);
    }

    /** Upsert by dedup_key so the same deadline never spams. Respects dismiss/snooze. */
    private function upsertAlert(array $a): void
    {
        $key = 'deadline:' . $a['source_id'] . ':' . $a['table'] . ':' . $a['record'];
        $existing = $this->store->one('SELECT id, status, due_at FROM eon_alerts WHERE dedup_key = :k', [':k' => $key]);
        $now = gmdate('c');

        if ($existing) {
            // If it was dismissed but the due date moved, reopen it; otherwise just refresh.
            $reopen = $existing['status'] === 'dismissed' && $existing['due_at'] !== $a['due_at'];
            $status = $reopen ? 'active' : $existing['status'];
            $this->store->run(
                'UPDATE eon_alerts SET label=:l, due_at=:d, urgency=:u, point_to=:pt, status=:st, updated_at=:t WHERE id=:id',
                [':l' => $a['label'], ':d' => $a['due_at'], ':u' => $a['urgency'], ':pt' => $a['point_to'],
                 ':st' => $status, ':t' => $now, ':id' => $existing['id']]
            );
            return;
        }
        $this->store->run(
            'INSERT INTO eon_alerts (type, source_id, table_name, record_id, label, due_at, urgency, point_to, dedup_key, status, created_at, updated_at)
             VALUES (:ty,:s,:tab,:rec,:l,:d,:u,:pt,:k,\'active\',:t,:t)',
            [':ty' => $a['type'], ':s' => $a['source_id'], ':tab' => $a['table'], ':rec' => $a['record'],
             ':l' => $a['label'], ':d' => $a['due_at'], ':u' => $a['urgency'], ':pt' => $a['point_to'],
             ':k' => $key, ':t' => $now]
        );
    }
}
