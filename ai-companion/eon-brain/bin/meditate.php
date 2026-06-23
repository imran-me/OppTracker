<?php
declare(strict_types=1);

/**
 * Scheduled meditation cycle. Wire this to cron (default every 15 min):
 *
 *   *​/15 * * * *  php /path/to/ai-companion/eon-brain/bin/meditate.php >> /var/log/eon.log 2>&1
 *
 * Runs: learn → scan deadlines → raise reminders → publish insight.
 */

require __DIR__ . '/../bootstrap.php';

$started = microtime(true);
$brain = eon_brain();
$result = $brain->meditate();
$result['ms'] = (int)round((microtime(true) - $started) * 1000);

fwrite(STDOUT, '[' . gmdate('c') . "] EON meditated: " . json_encode($result, JSON_UNESCAPED_SLASHES) . PHP_EOL);
