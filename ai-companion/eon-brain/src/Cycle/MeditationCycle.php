<?php
declare(strict_types=1);

namespace EonBrain\Cycle;

use EonBrain\Deadlines\DeadlineScanner;
use EonBrain\Learning\Learner;
use EonBrain\Learning\MindState;
use EonBrain\Reminders\ReminderEngine;

/**
 * One meditation cycle: learn → scan deadlines → raise reminders → insight.
 * This is what the scheduler runs (default every 15 min) and what the avatar's
 * meditation animation reflects through MindState.
 */
final class MeditationCycle
{
    public function __construct(
        private Learner $learner,
        private DeadlineScanner $scanner,
        private ReminderEngine $reminders,
        private MindState $state,
        private array $cfg
    ) {}

    public function run(int $sourceId): array
    {
        // 1) absorb data (drives meditating → reading-section visuals)
        $this->learner->learn($sourceId);

        // 2) scan learned memory for deadlines → de-duplicated alerts
        $raised = $this->scanner->scan($sourceId);

        // 3) surface the feed and publish an INSIGHT (eyes open, points at it)
        $feed = $this->reminders->feed();
        $linger = (int)($this->cfg['insight_linger_seconds'] ?? 90);

        if ($feed) {
            $top = $feed[0];
            $msg = $top['type'] === 'deadline'
                ? sprintf('A deadline is approaching: %s (%s)', $top['label'], $top['urgency'])
                : sprintf('Reminder: %s', $top['label']);
            $this->state->insight($msg, $top['pointTo'] ?? null, $linger);
        } else {
            $this->state->set(MindState::IDLE, 1.0);
            $this->state->finishCycle();
        }

        return ['deadlinesRaised' => $raised, 'activeAlerts' => count($feed)];
    }
}
