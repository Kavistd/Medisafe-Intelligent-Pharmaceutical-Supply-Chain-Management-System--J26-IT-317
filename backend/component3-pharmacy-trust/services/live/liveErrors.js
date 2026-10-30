'use strict';

/** Safe, client-facing error for the live API: status, stable code and a message without internals. */
class ProcessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ProcessError';
    this.status = status;
    this.code = code;
  }
}

// PostgreSQL error codes that indicate rejected input or state rather than an outage.
const PG_TO_PROCESS = Object.freeze({
  23505: [409, 'DUPLICATE_RECORD', 'A record with this reference already exists.'],
  23514: [422, 'CONSTRAINT_VIOLATION', 'The change violates a data rule.'],
  23502: [422, 'MISSING_VALUE', 'A required value is missing.'],
  23503: [422, 'INVALID_REFERENCE', 'The change refers to a record that does not exist.'],
  '22P02': [422, 'INVALID_VALUE', 'A value has the wrong format.'],
  22007: [422, 'INVALID_VALUE', 'A value has the wrong format.'],
  22008: [422, 'INVALID_VALUE', 'A value is out of range.'],
  // Raised by the c3 forward-only and audit triggers.
  P0001: [409, 'TRANSITION_REJECTED', 'The database rejected this change as not permitted for the record state.'],
});

function translatePgError(error) {
  if (error instanceof ProcessError) return error;
  const mapped = error && PG_TO_PROCESS[error.code];
  if (mapped) return new ProcessError(...mapped);
  return new ProcessError(503, 'SERVICE_UNAVAILABLE', 'The request could not be completed. Try again later.');
}

module.exports = { ProcessError, translatePgError };
