/**
 * Security and sanitization utilities for ProximDB
 */

const SQL_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const QUALIFIED_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

export class SecurityError extends Error {
  constructor(message: string) {
    super(`[ProximDB Security] ${message}`);
    this.name = 'SecurityError';
  }
}

/**
 * Validates a SQL table or column identifier to prevent SQL injection through configuration
 */
export function validateIdentifier(name: string, allowQualified = false): string {
  if (!name || typeof name !== 'string') {
    throw new SecurityError(`Identifier must be a non-empty string. Received: ${typeof name}`);
  }

  const trimmed = name.trim();
  const regex = allowQualified ? QUALIFIED_IDENTIFIER_REGEX : SQL_IDENTIFIER_REGEX;

  if (!regex.test(trimmed)) {
    throw new SecurityError(
      `Invalid identifier "${name}". Identifiers must start with a letter/underscore and contain only alphanumeric characters and underscores.`
    );
  }

  return trimmed;
}

/**
 * Safely quotes a PostgreSQL identifier (e.g. "table" or "schema"."table")
 */
export function quotePostgresIdentifier(name: string): string {
  const validated = validateIdentifier(name, true);
  return validated
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

/**
 * Safely quotes a MySQL identifier (e.g. `table` or `database`.`table`)
 */
export function quoteMySQLIdentifier(name: string): string {
  const validated = validateIdentifier(name, true);
  return validated
    .split('.')
    .map((part) => `\`${part.replace(/`/g, '``')}\``)
    .join('.');
}

/**
 * Sanitizes and bounds search query text against ReDoS and memory bloat
 */
export function sanitizeSearchText(input: unknown, maxLength = 250): string {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return '';
  }
  // Strip null bytes and control characters (except common spaces/tabs)
  return String(input)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Safely parses and clamps query result limits to prevent memory exhaustion DoS
 */
export function sanitizeLimit(limit: unknown, defaultLimit = 10, maxLimit = 1000): number {
  if (limit === undefined || limit === null) return defaultLimit;
  const parsed = parseInt(String(limit), 10);
  if (isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

/**
 * Safely bounds recursive CTE depth to prevent combinatorial path explosion
 */
export function sanitizeMaxHops(hops: unknown, defaultHops = 2, maxHops = 5): number {
  if (hops === undefined || hops === null) return defaultHops;
  const parsed = parseInt(String(hops), 10);
  if (isNaN(parsed) || parsed <= 0) return defaultHops;
  return Math.min(Math.max(1, parsed), maxHops);
}

/**
 * Bounds fuzzy similarity threshold between 0.0 and 1.0
 */
export function sanitizeThreshold(threshold: unknown, defaultThreshold = 0.65): number {
  if (threshold === undefined || threshold === null) return defaultThreshold;
  const parsed = parseFloat(String(threshold));
  if (isNaN(parsed)) return defaultThreshold;
  return Math.min(Math.max(0.0, parsed), 1.0);
}

/**
 * Validates and sanitizes a user identifier
 */
export function sanitizeUserId(userId: unknown, maxLength = 250): string {
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    return '';
  }
  return String(userId)
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}
