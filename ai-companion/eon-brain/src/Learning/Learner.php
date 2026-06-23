<?php
declare(strict_types=1);

namespace EonBrain\Learning;

use EonBrain\Connector\PdoConnector;
use EonBrain\Knowledge\KnowledgeStore;

/**
 * The meditation brain. Reads the connected system's data (READ-ONLY, chunked,
 * incremental) into EON's Knowledge Store, and publishes the learning state +
 * progress that the avatar's meditation animation follows.
 *
 * Phase 1 indexes deadline-bearing tables, but the read/remember pipeline is
 * generic: point it at any table and it will normalize rows into memory.
 */
final class Learner
{
    public function __construct(
        private PdoConnector $source,
        private KnowledgeStore $knowledge,
        private MindState $state,
        private array $cfg
    ) {}

    public function learn(int $sourceId): void
    {
        $maps = $this->knowledge->tableMaps($sourceId);
        // Phase 1 scope: tables that carry a deadline column.
        $maps = array_values(array_filter($maps, static fn ($m) => !empty($m['deadline_column'])));

        $this->state->set(MindState::MEDITATING, 0.0);
        $pauseMs = (int)($this->cfg['meditation_pause_ms'] ?? 0);
        $chunk   = max(50, (int)($this->cfg['chunk_size'] ?? 1000));
        $grace   = max(...($this->cfg['windows'] ?? [7])) + 1;     // keep a little history

        $total = max(1, count($maps));
        foreach ($maps as $i => $m) {
            $table = (string)$m['table_name'];
            $this->state->set(MindState::READING, ($i) / $total, $table);

            $this->learnTable($sourceId, $m, $chunk, (int)$grace);
            $this->knowledge->markTableLearned($sourceId, $table);

            if ($pauseMs > 0) {
                usleep($pauseMs * 1000);     // let the avatar visibly "read" this section
            }
        }

        $this->knowledge->markSourceLearned($sourceId);
        $this->state->set(MindState::MEDITATING, 1.0);
    }

    private function learnTable(int $sourceId, array $m, int $chunk, int $graceDays): void
    {
        $table    = (string)$m['table_name'];
        $pk       = (string)($m['pk_column'] ?: 'id');
        $deadline = (string)$m['deadline_column'];
        $label    = (string)($m['label_column'] ?: '');

        $qt = $this->source->quoteIdent($table);
        $qd = $this->source->quoteIdent($deadline);
        $graceDate = gmdate('Y-m-d', time() - $graceDays * 86400);

        $offset = 0;
        while (true) {
            // READ-ONLY: identifiers are whitelisted from discovery + quoted; value is bound.
            $sql = "SELECT * FROM {$qt}
                    WHERE {$qd} IS NOT NULL AND {$qd} <> '' AND {$qd} >= :grace
                    ORDER BY {$qd} ASC
                    LIMIT {$chunk} OFFSET {$offset}";
            $rows = $this->source->select($sql, [':grace' => $graceDate]);
            if (!$rows) {
                break;
            }
            foreach ($rows as $row) {
                $recordId = (string)($row[$pk] ?? '');
                if ($recordId === '') {
                    continue;
                }
                $labelVal = $label !== '' ? (string)($row[$label] ?? '') : '';
                if ($labelVal === '') {
                    $labelVal = $table . ' #' . $recordId;
                }
                $this->knowledge->remember(
                    $sourceId, $table, $recordId,
                    $labelVal,
                    $this->toIso((string)($row[$deadline] ?? '')),
                    $row
                );
            }
            if (count($rows) < $chunk) {
                break;
            }
            $offset += $chunk;
        }
    }

    /** Normalize a source date/datetime string to ISO-8601 UTC. */
    private function toIso(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        $ts = strtotime($value);
        return $ts === false ? $value : gmdate('c', $ts);
    }
}
