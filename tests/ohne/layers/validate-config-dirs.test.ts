import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { validateConfigDirs } from '../../../src/ohne/index.ts';
import { isArray } from '../../../src/utils/index.ts';

const file = '/app/ohne.config.ts';

function bodyMatches(pattern: RegExp) {
  return (error: unknown) => {
    const body = (error as { body?: string | string[] }).body;
    const text = isArray(body) ? body.join('\n') : (body ?? '');
    return pattern.test(text);
  };
}

describe('validateConfigDirs', () => {
  it('accepts distinct directories', () => {
    doesNotThrow(() => validateConfigDirs({ api: 'routes', messages: 'i18n' }, file));
  });

  it('accepts an override that clears a default clash', () => {
    doesNotThrow(() => validateConfigDirs({ api: 'messages', messages: 'catalogs' }, file));
  });

  it('accepts an empty override', () => {
    doesNotThrow(() => validateConfigDirs({}, file));
  });

  it('throws when one directory nests inside another', () => {
    throws(
      () => validateConfigDirs({ api: 'src', messages: 'src/messages' }, file),
      bodyMatches(/contains/),
    );
  });

  it('throws when the nesting is written in reverse order', () => {
    throws(
      () => validateConfigDirs({ messages: 'src/messages', api: 'src' }, file),
      bodyMatches(/contains/),
    );
  });

  it('throws when two directories resolve to the same path', () => {
    throws(
      () => validateConfigDirs({ api: 'shared', boot: './shared' }, file),
      bodyMatches(/both point at/),
    );
  });

  it('throws when an override lands on another key default', () => {
    throws(() => validateConfigDirs({ api: 'messages' }, file), bodyMatches(/both point at/));
  });

  it('throws when an override nests inside another key default', () => {
    throws(() => validateConfigDirs({ api: 'messages/http' }, file), bodyMatches(/contains/));
  });

  it('carries the config file as the error path', () => {
    throws(
      () => validateConfigDirs({ api: 'src', boot: 'src/boot' }, file),
      (error: unknown) => (error as { path?: string }).path === file,
    );
  });
});
