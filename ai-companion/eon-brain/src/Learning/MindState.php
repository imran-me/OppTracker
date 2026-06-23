<?php
declare(strict_types=1);

namespace EonBrain\Learning;

use EonBrain\Storage\BrainStore;

/**
 * The learning lifecycle the avatar reads to drive the MEDITATION visuals:
 *   idle → meditating → reading-section → insight → idle
 * plus a 0..1 progress value and the section currently being read.
 */
final class MindState
{
    public const IDLE       = 'idle';
    public const MEDITATING = 'meditating';
    public const READING    = 'reading-section';
    public const INSIGHT    = 'insight';

    public function __construct(private BrainStore $store) {}

    public function set(string $state, float $progress = 0.0, ?string $section = null): void
    {
        $this->store->run(
            "UPDATE eon_state SET state=:s, progress=:p, section=:sec, updated_at=:t WHERE id=1",
            [':s' => $state, ':p' => max(0, min(1, $progress)), ':sec' => $section, ':t' => gmdate('c')]
        );
    }

    public function insight(string $message, ?string $pointTo, int $lingerSeconds): void
    {
        $this->store->run(
            "UPDATE eon_state SET state=:s, progress=1, message=:m, point_to=:pt,
             insight_until=:iu, last_cycle_at=:t, updated_at=:t WHERE id=1",
            [':s' => self::INSIGHT, ':m' => $message, ':pt' => $pointTo,
             ':iu' => gmdate('c', time() + $lingerSeconds), ':t' => gmdate('c')]
        );
    }

    public function finishCycle(): void
    {
        $this->store->run("UPDATE eon_state SET last_cycle_at=:t, updated_at=:t WHERE id=1", [':t' => gmdate('c')]);
    }

    /** Current state for the API; auto-decays 'insight' back to 'idle'. */
    public function current(): array
    {
        $row = $this->store->one('SELECT * FROM eon_state WHERE id=1') ?? [];
        $state = (string)($row['state'] ?? self::IDLE);
        $until = $row['insight_until'] ?? null;
        if ($state === self::INSIGHT && $until && strtotime($until) < time()) {
            $state = self::IDLE;
            $this->store->run("UPDATE eon_state SET state='idle', updated_at=:t WHERE id=1", [':t' => gmdate('c')]);
        }
        return [
            'state'        => $state,
            'progress'     => (float)($row['progress'] ?? 0),
            'section'      => $row['section'] ?? null,
            'message'      => $row['message'] ?? null,
            'pointTo'      => $row['point_to'] ?? null,
            'lastCycleAt'  => $row['last_cycle_at'] ?? null,
            'updatedAt'    => $row['updated_at'] ?? null,
        ];
    }
}
