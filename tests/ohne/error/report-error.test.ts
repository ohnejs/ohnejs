import { ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { FieldErrors } from '../../../src/ohne/index.ts';

import { ohneError } from '../../../src/ohne/error/ohne-error.ts';
import { reportError } from '../../../src/ohne/error/report-error.ts';
import { notFound } from '../../../src/ohne/http/http-error.ts';
import { collectMessages } from '../../../src/ohne/messages/collect-messages.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { busyError } from '../../../src/ohne/query/write/busy.ts';
import { referenceViolation, validationError } from '../../../src/ohne/query/write/errors.ts';
import { groupBy } from '../../../src/utils/index.ts';
import { createPrinter, type Printer } from '../../../src/utils/print/index.ts';

declare module 'ohnejs' {
  interface KnownMessages {
    'validation.maxValue': { max: number };
  }
}

function capture(debug = false): { printer: Printer; text: () => string } {
  const out: string[] = [];
  const printer = createPrinter({ color: false, debug, stream: { write: (s) => out.push(s) } });
  return { printer, text: () => out.join('') };
}

/**
 * Reports `error` into a colorless printer and returns what it wrote.
 */
function report(error: unknown, debug = false): string {
  const { printer, text } = capture(debug);
  reportError(error, printer);
  return text();
}

/**
 * Builds a stack frame at `file`, a path under the framework `src`.
 */
function frame(file: string, line: number): string {
  return `    at run (${new URL(`../../../src/${file}`, import.meta.url).href}:${line}:17)`;
}

before(async () => {
  const base = { name: 'base', dir: fileURLToPath(new URL('../../../src/base', import.meta.url)) };
  const catalogs = groupBy(await collectMessages([base]), (message) => message.language);
  for (const [language, messages] of Object.entries(catalogs)) {
    useMessages().register(language, Object.fromEntries(messages!.map((m) => [m.key, m.template])));
  }
});

after(() => {
  useMessages().clear();
});

describe('reportError', () => {
  it('renders a rich ohneError as a block with title, body rows, and path', () => {
    const { printer, text } = capture();
    reportError(
      ohneError({
        title: 'Invalid `port`',
        body: ['Port must be 0-65535.', 'You set 99999.'],
        path: 'ohne.config.ts:3:5',
      }),
      printer,
    );

    const out = text();
    ok(out.includes('Invalid port')); // backtick markup is stripped when color is off
    ok(out.includes('Port must be 0-65535.'));
    ok(out.includes('You set 99999.'));
    ok(out.includes('ohne.config.ts:3:5'));
    ok(out.includes('│')); // rail = block
  });

  it('renders a bare ohneError as a single line, not a block', () => {
    const { printer, text } = capture();
    reportError(ohneError('Project has no routes'), printer);

    const out = text();
    ok(out.includes('Project has no routes'));
    ok(!out.includes('│')); // no rail = line
  });

  it('renders a raw error as a block titled by its name', () => {
    const { printer, text } = capture();
    reportError(new TypeError('cannot read x'), printer);

    const out = text();
    ok(out.includes('TypeError'));
    ok(out.includes('cannot read x'));
  });

  it('pulls a file location from the stack into the corner', () => {
    const { printer, text } = capture();
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file:///abs/foo.ts:3:7)';
    reportError(error, printer);

    ok(text().includes('/abs/foo.ts:3:7'));
  });

  it('pulls a column-less location from a TypeScript syntax-error preamble', () => {
    const { printer, text } = capture();
    const error = new SyntaxError('Parenthesized expression cannot be empty');
    error.stack =
      'file:///abs/oops.get.ts:2\n' +
      'export default defineHandler(() => ( );\n' +
      '                                   ^^^\n\n' +
      'SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Parenthesized expression cannot be empty\n' +
      '    at parseTypeScript (node:internal/modules/typescript:63:36)';
    reportError(error, printer);

    ok(text().includes('/abs/oops.get.ts:2'));
  });

  it('shows the stack only under debug', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file:///abs/foo.ts:3:7)';

    const quiet = capture(false);
    reportError(error, quiet.printer);
    ok(!quiet.text().includes('at fn'));

    const loud = capture(true);
    reportError(error, loud.printer);
    ok(loud.text().includes('at fn'));
  });

  it('renders a validation error as one translated row per field', () => {
    const out = report(
      validationError({ name: 'validation.required', faction: 'validation.invalidValue' }),
    );

    strictEqual(out.split('\n')[0], '●  Validation failed');
    ok(out.includes('name: This field is required'));
    ok(out.includes('faction: This value is invalid'));
    ok(!out.includes('Validation failed: name, faction'));
  });

  it('prints the validation rows on adjacent lines', () => {
    const out = report(
      validationError({ name: 'validation.required', faction: 'validation.invalidValue' }),
    );

    ok(out.includes('│  name: This field is required\n│  faction: This value is invalid\n'));
  });

  it('resolves a `{ key, params }` field message with its params', () => {
    const out = report(
      validationError({ level: { key: 'validation.maxValue', params: { max: 60 } } }),
    );

    ok(out.includes('level: This value must be at most 60'));
  });

  it('prints a row for a field keyed `__proto__`', () => {
    const errors: FieldErrors = Object.create(null);
    errors['__proto__'] = 'validation.required';

    ok(report(validationError(errors)).includes('__proto__: This field is required'));
  });

  it('puts the corner at the first frame outside the framework `src`', () => {
    const error = validationError({ name: 'validation.required' });
    error.stack = [
      'ValidationError: Validation failed: name',
      frame('ohne/query/write/errors.ts', 40),
      '    at file:///abs/commands/summon-thrall.ts:7:5',
    ].join('\n');
    const out = report(error);

    ok(out.includes('/abs/commands/summon-thrall.ts:7:5'));
    ok(!out.includes('errors.ts'));
  });

  it('leaves the corner bare when every frame is inside the framework `src`', () => {
    const failures = [
      [validationError({ name: 'validation.required' }), 'ohne/query/write/errors.ts'],
      [busyError(), 'ohne/query/write/busy.ts'],
      [notFound('No such hero'), 'ohne/http/http-error.ts'],
    ] as const;

    for (const [error, file] of failures) {
      error.stack = [
        `${error.name}: ${error.message}`,
        frame(file, 23),
        frame('ohne/cli/main.ts', 19),
      ].join('\n');
      const out = report(error);

      ok(!out.includes('└─'), out);
      ok(!/errors\.ts|busy\.ts|http-error\.ts|main\.ts/.test(out), out);
    }
  });

  it('titles a busy error and a reference violation by their message', () => {
    const busy = report(busyError(new Error('SQLITE_BUSY: database is locked')));
    strictEqual(busy.split('\n')[0], '●  Database is busy, retry the write');
    ok(!busy.includes('Error'));

    const blocked = report(referenceViolation());
    strictEqual(blocked.split('\n')[0], '●  A referenced record blocks this delete');
    ok(!blocked.includes('Error'));
  });

  it('shows a busy cause and the raw field errors only under debug', () => {
    const busy = busyError(new Error('SQLITE_BUSY: database is locked'));
    ok(report(busy, true).includes('SQLITE_BUSY: database is locked'));
    ok(!report(busy).includes('SQLITE_BUSY'));

    const invalid = validationError({ name: 'validation.required' });
    ok(report(invalid, true).includes("name: 'validation.required'"));
    ok(!report(invalid).includes('validation.required'));
  });

  it('puts the corner of an `HTTPError` at the line that built it', () => {
    const out = report(notFound('No such hero'));

    strictEqual(out.split('\n')[0], '●  HTTPError');
    ok(out.includes('No such hero'));
    ok(out.includes('tests/ohne/error/report-error.test.ts:'));
    ok(!out.includes('http-error.ts'));
  });
});
