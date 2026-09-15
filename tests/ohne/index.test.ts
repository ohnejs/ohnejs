import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  FieldErrors,
  GuardReport,
  Hooks,
  QueryIR,
  QueryRecord,
  ValidationError,
} from '../../src/ohne/index.ts';

import * as ohne from '../../src/ohne/index.ts';
import { busyError } from '../../src/ohne/query/write/busy.ts';
import { referenceViolation, validationError } from '../../src/ohne/query/write/errors.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('ohne', () => {
  it('exports the guards that tell a failed write apart', () => {
    strictEqual(ohne.isValidationError(validationError({ title: 'validation.required' })), true);
    strictEqual(ohne.isReferenceViolation(referenceViolation()), true);
    strictEqual(ohne.isBusyError(busyError()), true);
  });

  it('exports the types a caught validation failure carries', () => {
    const errors: Equal<ValidationError['errors'], FieldErrors> = true;
    const validate: Equal<Parameters<Hooks['record:validate']>[0], FieldErrors> = true;
    strictEqual(errors && validate, true);
  });

  it('exports the payload types the hooks carry', () => {
    const filter: Equal<Parameters<Hooks['query:filter']>[0], QueryIR> = true;
    const records: Equal<Parameters<Hooks['query:records']>[0], QueryRecord[]> = true;
    const synced: Equal<Parameters<Hooks['schema:synced']>[0], GuardReport> = true;
    strictEqual(filter && records && synced, true);
  });
});
