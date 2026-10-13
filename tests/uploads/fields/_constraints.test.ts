import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { checkListSize, uploadOptionsProblem } from '../../../src/uploads/fields/_constraints.ts';
import file from '../../../src/uploads/fields/file.ts';
import files from '../../../src/uploads/fields/files.ts';
import image from '../../../src/uploads/fields/image.ts';
import images from '../../../src/uploads/fields/images.ts';
import { isArray } from '../../../src/utils/index.ts';

describe('checkListSize', () => {
  it('rejects a provided empty list under `allowEmpty: false`', () => {
    strictEqual(checkListSize([], { allowEmpty: false }), 'validation.emptyValue');
  });

  it('accepts an empty list under `allowEmpty: true`', () => {
    strictEqual(checkListSize([], { allowEmpty: true }), undefined);
  });

  it('rejects a list below `min`', () => {
    deepStrictEqual(checkListSize(['u1'], { allowEmpty: true, min: 2 }), {
      key: 'validation.minItems',
      params: { min: 2 },
    });
  });

  it('rejects a list above `max`', () => {
    deepStrictEqual(checkListSize(['u1', 'u2', 'u3'], { allowEmpty: true, max: 2 }), {
      key: 'validation.maxItems',
      params: { max: 2 },
    });
  });

  it('accepts a list within bounds', () => {
    strictEqual(checkListSize(['u1', 'u2'], { allowEmpty: true, min: 1, max: 3 }), undefined);
  });

  it('passes a non-list untouched', () => {
    strictEqual(checkListSize('nope', { allowEmpty: false, min: 1 }), undefined);
    strictEqual(checkListSize(null, { allowEmpty: false, max: 0 }), undefined);
  });
});

describe('uploadOptionsProblem', () => {
  it('accepts a full, ordered set of bounds', () => {
    const options = {
      minSize: '1kb',
      maxSize: '5mb',
      minWidth: 100,
      maxWidth: 4000,
      minHeight: 100,
      maxHeight: 4000,
      min: 1,
      max: 6,
    };
    strictEqual(uploadOptionsProblem(options), undefined);
  });

  it('rejects a size it cannot read, and an inverted size', () => {
    deepStrictEqual(uploadOptionsProblem({ minSize: '5 megs' }), [
      '`minSize` is `5 megs`, which the field cannot read.',
      'Write it as a byte count or a size like `5mb`.',
    ]);
    deepStrictEqual(uploadOptionsProblem({ minSize: '5mb', maxSize: '1mb' }), [
      '`minSize` is `5mb`, above `maxSize` `1mb`, so no value can pass.',
      'Swap them, or lower `minSize`.',
    ]);
  });

  it('rejects inverted pixel and list bounds', () => {
    strictEqual(
      uploadOptionsProblem({ minWidth: 4000, maxWidth: 100 })?.[0].startsWith('`minWidth`'),
      true,
    );
    strictEqual(
      uploadOptionsProblem({ minHeight: 9, maxHeight: 1 })?.[0].startsWith('`minHeight`'),
      true,
    );
    strictEqual(uploadOptionsProblem({ min: 3, max: 1 })?.[0].startsWith('`min`'), true);
  });

  it('runs for every upload field type', () => {
    for (const type of [file, files, image, images]) {
      const check = type.validateOptions as (ctx: never) => unknown;
      strictEqual(isArray(check({ name: 'cover', options: { minSize: 'x' } } as never)), true);
    }
  });
});
