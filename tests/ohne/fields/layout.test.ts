import { deepStrictEqual, doesNotThrow, match, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import {
  layoutFieldNames,
  parseLayoutItem,
  validateLayout,
} from '../../../src/ohne/fields/layout.ts';

const NAMES = ['title', 'slug', 'body', 'price', 'published'];

const validate = (layout: unknown): void =>
  validateLayout(layout, NAMES, 'dashboard.layout', ' in collection `Posts`');

const body = (error: { body?: string | string[] }): string => [error.body].flat().join('\n');

describe('validateLayout', () => {
  it('accepts every node kind once', () => {
    doesNotThrow(() =>
      validate([
        { card: [{ row: ['title', 'slug | 40%'] }, 'body'] },
        {
          tabs: [
            { label: 'Pricing', fields: ['price | 8rem'] },
            {
              label: { key: 'app.tab', params: { n: 1 } },
              fields: [{ card: { fields: ['published | auto'] } }],
            },
          ],
        },
        '---',
      ]),
    );
  });

  it('accepts an omitted layout', () => {
    doesNotThrow(() => validate(undefined));
  });

  it('rejects a non-array', () => {
    throws(() => validate({ row: ['title'] }), /Invalid `dashboard\.layout` declaration/);
  });

  it('rejects an empty list', () => {
    throws(() => validate([]), /`dashboard\.layout` list is empty/);
  });

  it('rejects an unknown field, suggesting the nearest', () => {
    throws(
      () => validate(['titel']),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /unknown field `titel`/);
        match(body(error), /Did you mean `title`\?/);
        return true;
      },
    );
  });

  it('rejects a repeated field, across containers', () => {
    throws(() => validate(['title', { card: ['title'] }]), /repeats field `title`/);
  });

  it('rejects an entry naming no field', () => {
    throws(() => validate([' | 8rem']), /entry names no field/);
  });

  it('rejects an entry with more than one width', () => {
    throws(() => validate(['title | 8rem | 4rem']), /Invalid `dashboard\.layout` entry/);
  });

  it('accepts a CSS length, a percentage, auto, or an empty width, and rejects the rest', () => {
    doesNotThrow(() => validate(['title | 8rem', 'slug | 50%', 'body | auto', 'price |']));
    throws(() => validate(['title | wide']), /Invalid `dashboard\.layout` width `wide`/);
    throws(() => validate(['title | 12']), /width `12`/);
  });

  it('rejects a node that is neither a string nor an object', () => {
    throws(() => validate([42]), /Invalid `dashboard\.layout` node/);
    throws(() => validate([null]), /Invalid `dashboard\.layout` node/);
  });

  it('rejects an object node without exactly one known key', () => {
    throws(
      () => validate([{}]),
      (error: unknown) => {
        ok(isOhneError(error));
        match(body(error), /holds no keys/);
        return true;
      },
    );
    throws(
      () => validate([{ row: ['title'], card: ['slug'] }]),
      (error: unknown) => {
        ok(isOhneError(error));
        match(body(error), /holds `row`, `card`/);
        return true;
      },
    );
    throws(() => validate([{ column: ['title'] }]), /Invalid `dashboard\.layout` node/);
  });

  it('rejects an empty or non-array row', () => {
    throws(() => validate([{ row: [] }]), /Invalid `dashboard\.layout` row/);
    throws(() => validate([{ row: 'title' }]), /Invalid `dashboard\.layout` row/);
  });

  it('rejects a nested row and a rule in a row', () => {
    throws(() => validate([{ row: [{ row: ['title'] }] }]), /row nests a row/);
    throws(() => validate([{ row: ['title', '---'] }]), /row holds a rule/);
  });

  it('accepts a card and tabs inside a row', () => {
    doesNotThrow(() =>
      validate([{ row: [{ card: ['title'] }, { tabs: [{ label: 'A', fields: ['slug'] }] }] }]),
    );
  });

  it('rejects a malformed card', () => {
    throws(() => validate([{ card: [] }]), /Invalid `dashboard\.layout` card/);
    throws(() => validate([{ card: 'title' }]), /Invalid `dashboard\.layout` card/);
    throws(() => validate([{ card: { fields: [] } }]), /Invalid `dashboard\.layout` card/);
    throws(() => validate([{ card: { label: 'A' } }]), /Invalid `dashboard\.layout` card/);
  });

  it('rejects an unknown card key, a bad label, and a bad collapsible flag', () => {
    throws(() => validate([{ card: { header: 'A', fields: ['title'] } }]), /card key `header`/);
    throws(
      () => validate([{ card: { label: 42, fields: ['title'] } }]),
      /Invalid `dashboard\.layout` card label/,
    );
    throws(() => validate([{ card: { label: {}, fields: ['title'] } }]), /card label/);
    throws(
      () => validate([{ card: { collapsible: 'yes', fields: ['title'] } }]),
      /card `collapsible` flag/,
    );
  });

  it('rejects malformed tabs', () => {
    throws(() => validate([{ tabs: [] }]), /Invalid `dashboard\.layout` tabs/);
    throws(() => validate([{ tabs: ['title'] }]), /Invalid `dashboard\.layout` tabs/);
    throws(() => validate([{ tabs: [{ fields: ['title'] }] }]), /tab has no label/);
    throws(
      () => validate([{ tabs: [{ label: 42, fields: ['title'] }] }]),
      /Invalid `dashboard\.layout` tab label/,
    );
    throws(() => validate([{ tabs: [{ label: 'A', fields: [] }] }]), /tab has no fields/);
    throws(
      () => validate([{ tabs: [{ label: 'A', fields: ['title'], icon: 'x' }] }]),
      /tab key `icon`/,
    );
  });

  it('carries the option name and scope into every message', () => {
    throws(
      () => validateLayout(['nope'], NAMES, 'layout', ' on field `meta` in block `Hero`'),
      (error: unknown) => {
        ok(isOhneError(error));
        match(error.title ?? '', /`layout` references unknown field `nope`/);
        match(body(error), /declared on field `meta` in block `Hero`/);
        return true;
      },
    );
  });
});

describe('parseLayoutItem', () => {
  it('splits the name and the trimmed width', () => {
    deepStrictEqual(parseLayoutItem('title'), { name: 'title' });
    deepStrictEqual(parseLayoutItem('price | 8rem'), { name: 'price', width: '8rem' });
    deepStrictEqual(parseLayoutItem('slug|50%'), { name: 'slug', width: '50%' });
    deepStrictEqual(parseLayoutItem('body |'), { name: 'body' });
  });
});

describe('layoutFieldNames', () => {
  it('walks rows, cards, and tabs in reading order, skipping rules', () => {
    deepStrictEqual(
      layoutFieldNames([
        { row: ['a', 'b | 8rem'] },
        '---',
        { card: ['c', { card: { fields: ['d'] } }] },
        {
          tabs: [
            { label: 'x', fields: ['e'] },
            { label: 'y', fields: [{ row: ['f'] }] },
          ],
        },
        'g',
      ]),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    );
  });
});
