import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { MessageSyntaxError } from '../../../src/utils/i18n/message-errors.ts';
import {
  messageParamTypes,
  messageParamTypesAST,
} from '../../../src/utils/i18n/message-param-types.ts';
import { parseMessage } from '../../../src/utils/i18n/parse-message.ts';

describe('messageParamTypes - no parameters', () => {
  it('returns an empty map for plain literal text', () => {
    deepStrictEqual(messageParamTypes('hello world'), {});
  });

  it('returns an empty map for the empty template', () => {
    deepStrictEqual(messageParamTypes(''), {});
  });
});

describe('messageParamTypes - simple kinds', () => {
  it('types a plain `{name}` as a value', () => {
    deepStrictEqual(messageParamTypes('Hi {name}'), { name: { kind: 'value' } });
  });

  it('types `{n, number}` as a number', () => {
    deepStrictEqual(messageParamTypes('{n, number}'), { n: { kind: 'number' } });
  });

  it('types `{n, plural}` as a number', () => {
    deepStrictEqual(messageParamTypes('{n, plural, one {# item} other {# items}}'), {
      n: { kind: 'number' },
    });
  });

  it('types `{n, selectordinal}` as a number', () => {
    deepStrictEqual(messageParamTypes('{n, selectordinal, one {#st} other {#th}}'), {
      n: { kind: 'number' },
    });
  });

  it('types `{d, date}` and `{d, time}` as a date', () => {
    deepStrictEqual(messageParamTypes('{d, date}'), { d: { kind: 'date' } });
    deepStrictEqual(messageParamTypes('{d, time}'), { d: { kind: 'date' } });
  });
});

describe('messageParamTypes - select', () => {
  it('types `{g, select, ...}` as a choice of its keywords, excluding `other`', () => {
    deepStrictEqual(messageParamTypes('{g, select, female {she} male {he} other {they}}'), {
      g: { kind: 'choice', options: ['female', 'male'] },
    });
  });

  it('unions the keywords when one name drives two selects', () => {
    deepStrictEqual(messageParamTypes('{s, select, a {A} other {}} {s, select, b {B} other {}}'), {
      s: { kind: 'choice', options: ['a', 'b'] },
    });
  });
});

describe('messageParamTypes - nested bodies', () => {
  it('collects parameters inside plural cases', () => {
    deepStrictEqual(messageParamTypes('{n, plural, one {# of {total}} other {# of {total}}}'), {
      n: { kind: 'number' },
      total: { kind: 'value' },
    });
  });

  it('collects parameters inside select cases', () => {
    deepStrictEqual(messageParamTypes('{g, select, female {Hi {name}} other {Hello {name}}}'), {
      g: { kind: 'choice', options: ['female'] },
      name: { kind: 'value' },
    });
  });
});

describe('messageParamTypes - multi-role narrowing', () => {
  it('narrows a value reused as a plural to a number', () => {
    deepStrictEqual(messageParamTypes('Must be {min} {min, plural, one {x} other {y}}'), {
      min: { kind: 'number' },
    });
  });

  it('narrows a value reused as a date to a number', () => {
    deepStrictEqual(messageParamTypes('{x} on {x, date}'), { x: { kind: 'number' } });
  });

  it('narrows a number and a date on the same name to a number', () => {
    deepStrictEqual(messageParamTypes('{x, number} {x, date}'), { x: { kind: 'number' } });
  });

  it('narrows a value reused as a select to a choice', () => {
    deepStrictEqual(messageParamTypes('{s} {s, select, a {A} other {}}'), {
      s: { kind: 'choice', options: ['a'] },
    });
  });

  it('keeps a value when a name is only ever a plain argument', () => {
    deepStrictEqual(messageParamTypes('{a} and {a}'), { a: { kind: 'value' } });
  });
});

describe('messageParamTypes - irreconcilable uses', () => {
  it('rejects a name used as both a number and a select', () => {
    throws(() => messageParamTypes('{x, number} {x, select, a {A} other {}}'), /both a number/);
  });

  it('rejects regardless of the order the uses appear', () => {
    throws(() => messageParamTypes('{x, select, a {A} other {}} {x, number}'), /both a choice/);
  });

  it('rejects a date used together with a select on one name', () => {
    throws(() => messageParamTypes('{x, date} {x, select, a {A} other {}}'), /both a date/);
  });
});

describe('messageParamTypes - edge cases', () => {
  it('keeps numeric and positional names verbatim', () => {
    deepStrictEqual(messageParamTypes('{0} and {1, number}'), {
      0: { kind: 'value' },
      1: { kind: 'number' },
    });
  });

  it('ignores literal and pound nodes', () => {
    deepStrictEqual(messageParamTypes('{n, plural, one {# only} other {# total}}'), {
      n: { kind: 'number' },
    });
  });

  it('propagates a parse error from a malformed template', () => {
    throws(() => messageParamTypes('{'), MessageSyntaxError);
  });
});

describe('messageParamTypesAST', () => {
  it('matches the parse-then-walk convenience form', () => {
    const template = 'Must be {min} {min, plural, one {x} other {y}}';
    deepStrictEqual(messageParamTypesAST(parseMessage(template)), messageParamTypes(template));
  });
});
