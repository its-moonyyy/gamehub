import { QueryFailedError } from 'typeorm';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * True when the database refused a write because a unique index was hit.
 *
 * The phone number is checked before it is saved, but two requests can pass
 * that check at the same instant — the unique index is the real gate. Callers
 * turn this into the same 409 the check would have thrown, instead of letting
 * a race escape as a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driver = (error as QueryFailedError & { driverError?: { code?: string } })
    .driverError;
  return (driver?.code ?? (error as unknown as { code?: string }).code) === UNIQUE_VIOLATION;
}
