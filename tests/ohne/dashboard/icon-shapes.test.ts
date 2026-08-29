import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { iconNames, iconShape, isIconName } from '../../../src/ohne/dashboard/icon-shapes.ts';

describe('iconShape', () => {
  it('returns the markup that goes inside a 24x24 svg', () => {
    const shape = iconShape('note');
    ok(shape);
    ok(shape.startsWith('<path '));
    ok(shape.includes('stroke="currentColor"'));
    ok(!shape.includes('<svg'));
  });

  it('returns undefined for a name the set does not carry', () => {
    strictEqual(iconShape('definitely-not-an-icon'), undefined);
  });

  it('does not reach an inherited name', () => {
    strictEqual(iconShape('constructor'), undefined);
    strictEqual(iconShape('toString'), undefined);
    strictEqual(iconShape('__proto__'), undefined);
  });
});

describe('isIconName', () => {
  it('accepts a vendored name', () => {
    strictEqual(isIconName('brand-github'), true);
  });

  it('rejects an unknown name', () => {
    strictEqual(isIconName('brand-githbu'), false);
  });

  it('rejects an inherited name', () => {
    strictEqual(isIconName('constructor'), false);
    strictEqual(isIconName('hasOwnProperty'), false);
  });
});

describe('iconNames', () => {
  it('lists the whole set, sorted', () => {
    const names = iconNames();
    ok(names.length > 6000);
    ok(names.every((name, index) => index === 0 || names[index - 1]! < name));
  });

  it('names only lowercase kebab-case icons, so a name is URL-safe', () => {
    ok(iconNames().every((name) => /^[a-z0-9-]+$/.test(name)));
  });
});
