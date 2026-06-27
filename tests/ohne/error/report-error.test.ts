import { ok } from 'node:assert';
import { describe, it } from 'node:test';

import { ohneError } from '../../../src/ohne/error/ohne-error.ts';
import { reportError } from '../../../src/ohne/error/report-error.ts';
import { createPrinter, type Printer } from '../../../src/utils/print/index.ts';

function capture(debug = false): { printer: Printer; text: () => string } {
  const out: string[] = [];
  const printer = createPrinter({ color: false, debug, stream: { write: (s) => out.push(s) } });
  return { printer, text: () => out.join('') };
}

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
});
