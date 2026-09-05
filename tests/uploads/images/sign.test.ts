import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import {
  imageSecrets,
  signImageVariant,
  verifyImageVariant,
} from '../../../src/uploads/images/sign.ts';

describe('signImageVariant', () => {
  it('matches the protocol vectors', () => {
    strictEqual(
      signImageVariant('w_800,f_webp', 'photos/sunset.jpg', 'secret'),
      '2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck',
    );
    strictEqual(
      signImageVariant('w_320,h_320,fit_inside', 'photos/sunset.jpg', 'another'),
      's9YxH4SXC6gGsS97gs_WMTAcNvgSnZe7zUBB__NeUMs',
    );
  });
});

describe('verifyImageVariant', () => {
  it('accepts any listed secret and nothing else', () => {
    const signature = signImageVariant('w_800', 'a.jpg', 'old');
    strictEqual(verifyImageVariant(signature, 'w_800', 'a.jpg', ['new', 'old']), true);
    strictEqual(verifyImageVariant(signature, 'w_800', 'a.jpg', ['new']), false);
    strictEqual(verifyImageVariant(signature, 'w_801', 'a.jpg', ['old']), false);
    strictEqual(verifyImageVariant(signature, 'w_800', 'b.jpg', ['old']), false);
    strictEqual(verifyImageVariant('', 'w_800', 'a.jpg', ['old']), false);
    strictEqual(verifyImageVariant(signature, 'w_800', 'a.jpg', []), false);
  });
});

describe('imageSecrets', () => {
  it('splits the env var and drops empty entries', () => {
    useEnv().set('IMAGES_SECRET', ' new , old,, ');
    deepStrictEqual(imageSecrets(), ['new', 'old']);
    useEnv().set('IMAGES_SECRET', undefined);
    deepStrictEqual(imageSecrets(), []);
    useEnv().unset('IMAGES_SECRET');
  });
});
