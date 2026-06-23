<?php
declare(strict_types=1);

namespace EonBrain\Reminders;

use EonBrain\Storage\BrainStore;

/**
 * Manual reminders (you create) + auto-reminders (raised from deadlines by the
 * DeadlineScanner) surface through one feed. Supports seen / snooze / dismiss,
 * and never spams duplicates (deadline alerts are deduped at the source).
 *
 * Alert ids are prefixed so actions resolve to the right store:
 *   'alert-{id}'    → eon_alerts (deadline-derived)
 *   'reminder-{id}' → eon_reminders (manual)
 */
final class ReminderEngine
{
    public function __construct(private BrainStore $store) {}

    public function createReminder(string $title, ?string $note, string $remindAt, ?string $link): array
    {
        $iso = $this->toIso($remindAt) ?? $remindAt;
        $this->store->run(
            'INSERT INTO eon_reminders (title, note, remind_at, link, status, created_at) VALUES (:t,:n,:r,:l,\'active\',:c)',
            [':t' => $title, ':n' => $note, ':r' => $iso, ':l' => $link, ':c' => gmdate('c')]
        );
        $id = (int)$this->store->pdo()->lastInsertId();
        return ['id' => 'reminder-' . $id, 'title' => $title, 'remindAt' => $iso, 'status' => 'active'];
    }

    /** The unified, urgency-sorted feed the avatar consumes. */
    public function feed(): array
    {
        $now = gmdate('c');
        $out = [];

        // deadline alerts: active/seen, or snoozed whose snooze elapsed
        $alerts = $this->store->all(
            "SELECT * FROM eon_alerts
             WHERE status IN ('active','seen')
                OR (status='snoozed' AND (snooze_until IS NULL OR snooze_until <= :now))
             ORDER BY due_at ASC",
            [':now' => $now]
        );
        foreach ($alerts as $a) {
            $out[] = [
                'id'       => 'alert-' . $a['id'],
                'type'     => 'deadline',
                'label'    => $a['label'],
                'urgency'  => $a['urgency'],
                'severity' => $this->severityOf((string)$a['urgency']),
                'dueAt'    => $a['due_at'],
                'pointTo'  => $a['point_to'],
                'status'   => $a['status'],
                'source'   => ['table' => $a['table_name'], 'recordId' => $a['record_id']],
            ];
        }

        // manual reminders: only those that have come due
        $rem = $this->store->all(
            "SELECT * FROM eon_reminders WHERE status IN ('active','seen') AND remind_at <= :now ORDER BY remind_at ASC",
            [':now' => $now]
        );
        foreach ($rem as $r) {
            $out[] = [
                'id'       => 'reminder-' . $r['id'],
                'type'     => 'reminder',
                'label'    => $r['title'],
                'note'     => $r['note'],
                'urgency'  => 'reminder',
                'severity' => 2,
                'dueAt'    => $r['remind_at'],
                'pointTo'  => $r['link'],
                'status'   => $r['status'],
            ];
        }

        // sort: most urgent first, then soonest due
        usort($out, static function ($x, $y) {
            if ($x['severity'] !== $y['severity']) {
                return $y['severity'] <=> $x['severity'];
            }
            return strcmp((string)$x['dueAt'], (string)$y['dueAt']);
        });
        return $out;
    }

    public function markSeen(string $id): bool    { return $this->setStatus($id, 'seen'); }
    public function dismiss(string $id): bool     { return $this->setStatus($id, 'dismissed'); }

    public function snooze(string $id, int $minutes): bool
    {
        [$kind, $pk] = $this->parseId($id);
        $until = gmdate('c', time() + max(1, $minutes) * 60);
        if ($kind === 'alert') {
            $this->store->run('UPDATE eon_alerts SET status=\'snoozed\', snooze_until=:u, updated_at=:t WHERE id=:id',
                [':u' => $until, ':t' => gmdate('c'), ':id' => $pk]);
            return true;
        }
        if ($kind === 'reminder') {
            // push the reminder out into the future
            $this->store->run('UPDATE eon_reminders SET remind_at=:u, status=\'active\' WHERE id=:id', [':u' => $until, ':id' => $pk]);
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------
    private function setStatus(string $id, string $status): bool
    {
        [$kind, $pk] = $this->parseId($id);
        if ($kind === 'alert') {
            $this->store->run('UPDATE eon_alerts SET status=:s, updated_at=:t WHERE id=:id', [':s' => $status, ':t' => gmdate('c'), ':id' => $pk]);
            return true;
        }
        if ($kind === 'reminder') {
            $this->store->run('UPDATE eon_reminders SET status=:s WHERE id=:id', [':s' => $status, ':id' => $pk]);
            return true;
        }
        return false;
    }

    /** @return array{0:string,1:int} [kind, primaryKey] */
    private function parseId(string $id): array
    {
        if (str_starts_with($id, 'alert-'))    return ['alert', (int)substr($id, 6)];
        if (str_starts_with($id, 'reminder-')) return ['reminder', (int)substr($id, 9)];
        return ['', 0];
    }

    private function severityOf(string $urgency): int
    {
        return match (true) {
            $urgency === 'overdue'        => 6,
            $urgency === 'due-today'      => 5,
            str_starts_with($urgency, 'within-1') => 5,
            str_starts_with($urgency, 'within-3') => 4,
            str_starts_with($urgency, 'within-') => 3,
            default => 2,
        };
    }

    private function toIso(string $value): ?string
    {
        $ts = strtotime(trim($value));
        return $ts === false ? null : gmdate('c', $ts);
    }
}
