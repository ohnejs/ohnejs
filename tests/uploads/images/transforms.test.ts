import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  parseImageTransforms,
  stringifyImageTransforms,
} from '../../../src/uploads/images/transforms.ts';

describe('stringifyImageTransforms', () => {
  it('writes tokens in canonical order and omits defaults', () => {
    strictEqual(
      stringifyImageTransforms({
        dpr: 2,
        quality: 80,
        format: 'webp',
        fit: 'contain',
        height: 600,
        width: 800,
      }),
      'w_800,h_600,fit_contain,f_webp,q_80,dpr_2',
    );
    strictEqual(
      stringifyImageTransforms({ width: 800, fit: 'cover', position: 'center', dpr: 1 }),
      'w_800',
    );
    strictEqual(stringifyImageTransforms({}), '');
  });

  it('prefers a focal point over a position and rounds it', () => {
    strictEqual(
      stringifyImageTransforms({ height: 240, position: 'top', focalPoint: { x: 0.25, y: 1 } }),
      'h_240,fp_0.25_1',
    );
    strictEqual(stringifyImageTransforms({ focalPoint: { x: 0.33333, y: 0 } }), 'fp_0.333_0');
    strictEqual(stringifyImageTransforms({ position: 'topRight' }), 'p_topRight');
  });

  it('rounds a ratio to two decimals the parser accepts', () => {
    strictEqual(stringifyImageTransforms({ dpr: 1.555 }), 'dpr_1.56');
    strictEqual(stringifyImageTransforms({ dpr: 1.005 }), 'dpr_1.01');
    strictEqual(stringifyImageTransforms({ dpr: 1.001 }), '');
    deepStrictEqual(parseImageTransforms(stringifyImageTransforms({ dpr: 2.333 })), { dpr: 2.33 });
  });

  it('throws on an out-of-range value', () => {
    throws(() => stringifyImageTransforms({ width: 0 }), /`width`/);
    throws(() => stringifyImageTransforms({ height: 1.5 }), /`height`/);
    throws(() => stringifyImageTransforms({ quality: 101 }), /`quality`/);
    throws(() => stringifyImageTransforms({ dpr: 5 }), /`dpr`/);
    throws(() => stringifyImageTransforms({ focalPoint: { x: 2, y: 0 } }), /`focalPoint.x`/);
  });
});

describe('parseImageTransforms', () => {
  it('round-trips a canonical string', () => {
    const transforms = {
      width: 800,
      height: 600,
      fit: 'inside',
      format: 'avif',
      quality: 70,
      focalPoint: { x: 0.5, y: 0.125 },
      dpr: 1.5,
    } as const;
    const tokens = stringifyImageTransforms(transforms);
    strictEqual(tokens, 'w_800,h_600,fit_inside,f_avif,q_70,fp_0.5_0.125,dpr_1.5');
    deepStrictEqual(parseImageTransforms(tokens), transforms);
    deepStrictEqual(parseImageTransforms(''), {});
    deepStrictEqual(parseImageTransforms('p_left'), { position: 'left' });
  });

  it('rejects unknown, malformed, duplicate, and conflicting tokens', () => {
    for (const bad of [
      'rotate_90',
      'w_0',
      'w_08',
      'w_800,w_600',
      'q_0',
      'q_101',
      'fit_fill',
      'f_gif',
      'fp_1.5_0',
      'fp_0.1234_0',
      'fp_.5_0',
      'dpr_0.5',
      'dpr_5',
      'dpr_1.0',
      'p_top,fp_0_0',
      'w',
      ',',
    ]) {
      strictEqual(parseImageTransforms(bad), undefined, bad);
    }
  });
});
