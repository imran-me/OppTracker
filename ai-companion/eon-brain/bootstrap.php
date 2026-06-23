<?php
declare(strict_types=1);

/**
 * EON Brain — bootstrap.
 * PSR-4-ish autoloader (no Composer required) + a factory that builds the
 * Brain facade from config. Plain PHP so it drops into any PHP host.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'EonBrain\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $rel = str_replace('\\', '/', substr($class, strlen($prefix)));
    $path = __DIR__ . '/src/' . $rel . '.php';
    if (is_file($path)) {
        require $path;
    }
});

/**
 * Build a ready-to-use Brain. Pass an override config array for tests.
 */
function eon_brain(?array $overrideConfig = null): \EonBrain\Brain
{
    $config = $overrideConfig ?? require __DIR__ . '/config/brain.config.php';
    return \EonBrain\Brain::boot($config);
}
