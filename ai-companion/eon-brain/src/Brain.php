<?php
declare(strict_types=1);

namespace EonBrain;

use EonBrain\Connector\PdoConnector;
use EonBrain\Cycle\MeditationCycle;
use EonBrain\Deadlines\DeadlineScanner;
use EonBrain\Discovery\SchemaDiscovery;
use EonBrain\Knowledge\KnowledgeStore;
use EonBrain\Learning\Learner;
use EonBrain\Learning\MindState;
use EonBrain\Reminders\ReminderEngine;
use EonBrain\Storage\BrainStore;

/**
 * Facade that wires the whole brain together and is the single entry point for
 * the API and the scheduler. "Connect EON → he learns the system's all."
 */
final class Brain
{
    private ?int $sourceId = null;

    public function __construct(
        private array $cfg,
        private PdoConnector $source,
        private BrainStore $store,
        private KnowledgeStore $knowledge,
        private SchemaDiscovery $discovery,
        private Learner $learner,
        private DeadlineScanner $scanner,
        private ReminderEngine $reminders,
        private MindState $state,
        private MeditationCycle $cycle
    ) {}

    public static function boot(array $cfg): self
    {
        $source    = new PdoConnector($cfg['source']);
        $store     = new BrainStore($cfg['brain']);
        $knowledge = new KnowledgeStore($store);
        $state     = new MindState($store);
        $discovery = new SchemaDiscovery($source, $cfg);
        $learner   = new Learner($source, $knowledge, $state, $cfg);
        $scanner   = new DeadlineScanner($store, $knowledge, $cfg);
        $reminders = new ReminderEngine($store);
        $cycle     = new MeditationCycle($learner, $scanner, $reminders, $state, $cfg);

        return new self($cfg, $source, $store, $knowledge, $discovery, $learner, $scanner, $reminders, $state, $cycle);
    }

    /** Discover + map the connected system. Returns the discovered map. */
    public function connect(): array
    {
        $name = (string)($this->cfg['source']['name'] ?? 'default');
        $this->sourceId = $this->knowledge->registerSource($name, $this->source->driver());

        $map = $this->discovery->discover();
        foreach ($map as $desc) {
            $this->knowledge->saveTableMap($this->sourceId, $desc);
        }

        $tables = array_map(static fn ($d) => [
            'table'          => $d['table'],
            'columns'        => array_keys($d['columns']),
            'pkColumn'       => $d['pk_column'],
            'deadlineColumn' => $d['deadline_column'],
            'labelColumn'    => $d['label_column'],
            'updatedColumn'  => $d['updated_column'],
            'relations'      => $d['relations'],
        ], array_values($map));

        return ['sourceId' => $this->sourceId, 'driver' => $this->source->driver(), 'tables' => $tables];
    }

    private function sourceId(): int
    {
        if ($this->sourceId === null) {
            $this->connect();
        }
        return (int)$this->sourceId;
    }

    /** Run one full meditation cycle (learn → scan → raise → insight). */
    public function meditate(): array
    {
        $this->connect();                       // re-discover each cycle (stays portable)
        return $this->cycle->run($this->sourceId());
    }

    // ---- API surface consumed by the avatar ----
    public function state(): array            { return $this->state->current(); }
    public function alerts(): array           { return $this->reminders->feed(); }
    public function markSeen(string $id): bool { return $this->reminders->markSeen($id); }
    public function snooze(string $id, int $min): bool { return $this->reminders->snooze($id, $min); }
    public function dismiss(string $id): bool { return $this->reminders->dismiss($id); }

    public function createReminder(string $title, ?string $note, string $remindAt, ?string $link): array
    {
        return $this->reminders->createReminder($title, $note, $remindAt, $link);
    }

    /** General memory read — the hook future skills build on. */
    public function recall(?string $table = null, int $limit = 500): array
    {
        return $this->knowledge->records($this->sourceId(), $table, $limit);
    }
}
