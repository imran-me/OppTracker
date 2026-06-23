<?php
declare(strict_types=1);

namespace EonBrain\Connector;

/**
 * A Connector is how EON reaches a system. Connecting to a new system means
 * providing a new config block — NOT writing new code. Implement this once per
 * transport (generic SQL via PDO is provided); future transports (REST, etc.)
 * just implement the same contract.
 *
 * Connectors are STRICTLY READ-ONLY against the source. They expose only
 * SELECT-style access; there is no write path here by design.
 */
interface ConnectorInterface
{
    /** Short driver/transport name, e.g. 'sqlite' | 'mysql' | 'pgsql'. */
    public function driver(): string;

    /** Run a parameterised SELECT and return all rows as assoc arrays. */
    public function select(string $sql, array $params = []): array;

    /** Quote an identifier (table/column) safely for this driver. */
    public function quoteIdent(string $ident): string;

    /** Underlying PDO handle (read-only use only). */
    public function pdo(): \PDO;
}
