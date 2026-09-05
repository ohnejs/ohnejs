import { deepStrictEqual, doesNotThrow, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import {
  imageVariantTokens,
  resolveImageVariant,
  validateImageVariants,
} from '../../../src/uploads/images/variants.ts';

const PATH = '/variants-test';

function configure(variants: Record<string, object>): void {
  useLayers().add({ path: PATH, input: { uploads: { images: { variants } } } });
}

describe('resolveImageVariant', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('answers the configured transforms, the shipped thumbnail included', () => {
    configure({ hero: { width: 1200, fit: 'cover' } });
    deepStrictEqual(resolveImageVariant('thumbnail'), {
      width: 320,
      height: 320,
      fit: 'inside',
      format: 'webp',
    });
    deepStrictEqual(resolveImageVariant('hero'), { width: 1200, fit: 'cover' });
  });

  it('throws for an unknown name and for an inherited object key', () => {
    throws(
      () => resolveImageVariant('hero'),
      /Unknown image variant `hero`; define it under `uploads\.images\.variants`/,
    );
    throws(() => resolveImageVariant('constructor'), /Unknown image variant `constructor`/);
  });
});

describe('imageVariantTokens', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('writes the canonical tokens of every variant by name', () => {
    configure({ card: { width: 400, format: 'webp', dpr: 1 } });
    deepStrictEqual(imageVariantTokens(), {
      thumbnail: 'w_320,h_320,fit_inside,f_webp',
      card: 'w_400,f_webp',
    });
  });
});

describe('validateImageVariants', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('accepts the defaults and camelCase names', () => {
    doesNotThrow(validateImageVariants);
    configure({ cardWide2x: { width: 800, dpr: 2 } });
    doesNotThrow(validateImageVariants);
  });

  it('rejects a name that is not a camelCase identifier', () => {
    configure({ Hero: { width: 800 } });
    throws(validateImageVariants, (error: Error) => {
      deepStrictEqual(error.message, 'Invalid image variant `Hero`');
      return true;
    });
  });

  it('rejects a preset that asks for nothing', () => {
    configure({ card: { fit: 'cover', dpr: 1 } });
    throws(validateImageVariants, /Invalid image variant `card`/);
  });

  it('rejects a preset with an out-of-range value, naming the variant', () => {
    configure({ card: { width: 0 } });
    throws(validateImageVariants, /Invalid image variant `card`/);
  });
});
