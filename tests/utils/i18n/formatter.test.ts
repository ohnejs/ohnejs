import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { MessageFormatError, MessageSyntaxError } from '../../../src/utils/i18n/errors.ts';
import { createFormatter, formatMessage } from '../../../src/utils/i18n/formatter.ts';

describe('formatMessage', () => {
  it('parses + formats in one call', () => {
    strictEqual(formatMessage('Hello {name}!', { name: 'World' }, 'en'), 'Hello World!');
  });

  it('renders a plural with #', () => {
    strictEqual(
      formatMessage('{n, plural, one {# item} other {# items}}', { n: 3 }, 'en'),
      '3 items',
    );
  });

  it('propagates parse errors', () => {
    throws(() => formatMessage('Hello }', {}, 'en'), MessageSyntaxError);
  });

  it('propagates onError throws from format', () => {
    throws(
      () =>
        formatMessage('Hello {name}!', {}, 'en', {
          onError: (e) => {
            throw e;
          },
        }),
      MessageFormatError,
    );
  });
});

describe('createFormatter', () => {
  it('binds the language across calls', () => {
    const t = createFormatter('de-DE');
    const out = t('{n, number}', { n: 1234.5 });
    strictEqual(out.includes('1.234'), true);
  });

  it('binds onError across calls', () => {
    const errors: MessageFormatError[] = [];
    const t = createFormatter('en', { onError: (e) => errors.push(e) });
    t('Hello {name}!', {});
    t('Bye {who}!', {});
    strictEqual(errors.length, 2);
  });

  it('accepts a template with no params', () => {
    const t = createFormatter('en');
    strictEqual(t('plain text'), 'plain text');
  });

  it('returns a function, callable many times', () => {
    const t = createFormatter('en');
    strictEqual(t('{a}', { a: 'x' }), 'x');
    strictEqual(t('{a}', { a: 'y' }), 'y');
  });
});
