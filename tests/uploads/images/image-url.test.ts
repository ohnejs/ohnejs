import { match, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import {
  imageSrcSet,
  imageURL,
  isOptimizableImage,
  thumbnailURL,
} from '../../../src/uploads/images/image-url.ts';
import { decorateUpload } from '../../../src/uploads/uploads/decorate.ts';
import '../_fixture.ts';

const SERVICE = 'https://img.example.com/';

const sunset = { directory: 'photos', name: 'sunset.jpg', type: 'image/jpeg' };

describe('imageURL', () => {
  beforeEach(() => {
    useLayers().add({ path: '/images-test', input: { uploads: { images: { url: SERVICE } } } });
    useEnv().set('IMAGES_SECRET', 'secret');
  });

  afterEach(() => {
    useLayers().remove('/images-test');
    useEnv().unset('IMAGES_SECRET');
  });

  it('signs a variant under the service origin', () => {
    strictEqual(
      imageURL(sunset, { width: 800, format: 'webp' }),
      'https://img.example.com/2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck/w_800,f_webp/photos/sunset.jpg',
    );
  });

  it('fills the focal point from the upload when the transforms name no position', () => {
    match(
      imageURL({ ...sunset, focalX: 0.25, focalY: 1 }, { width: 800 }),
      /\/w_800,fp_0.25_1\/photos\/sunset.jpg$/,
    );
    match(
      imageURL({ ...sunset, focalX: 0.25, focalY: 1 }, { width: 800, position: 'top' }),
      /\/w_800,p_top\/photos\/sunset.jpg$/,
    );
    match(
      imageURL({ ...sunset, focalX: null, focalY: 0.5 }, { width: 800 }),
      /\/w_800\/photos\/sunset.jpg$/,
    );
  });

  it('answers the original for empty transforms and for types the service cannot render', () => {
    strictEqual(imageURL(sunset), '/uploads/photos/sunset.jpg');
    strictEqual(
      imageURL({ directory: '', name: 'report.pdf' }, { width: 800 }),
      '/uploads/report.pdf',
    );
    strictEqual(
      imageURL({ directory: '', name: 'logo.png' }, { width: 80 }).startsWith(SERVICE),
      true,
    );
  });

  it('answers the original without a service or without a secret', () => {
    useEnv().unset('IMAGES_SECRET');
    strictEqual(imageURL(sunset, { width: 800 }), '/uploads/photos/sunset.jpg');
    useEnv().set('IMAGES_SECRET', 'secret');
    useLayers().remove('/images-test');
    strictEqual(imageURL(sunset, { width: 800 }), '/uploads/photos/sunset.jpg');
  });

  it('builds a srcset and a thumbnail', () => {
    const srcset = imageSrcSet(sunset, [400, 800], { format: 'webp' });
    match(
      srcset,
      /^https:\/\/img\.example\.com\/[A-Za-z0-9_-]{43}\/w_400,f_webp\/photos\/sunset\.jpg 400w, https:\/\/img\.example\.com\/[A-Za-z0-9_-]{43}\/w_800,f_webp\/photos\/sunset\.jpg 800w$/,
    );
    match(thumbnailURL(sunset), /\/w_320,h_320,fit_inside,f_webp\/photos\/sunset\.jpg$/);
  });

  it('decorates a read with a thumbnail only when it can render one', () => {
    const image: Record<string, unknown> = { ...sunset, focalX: 0.5, focalY: 0.5 };
    decorateUpload(image);
    match(
      image.thumbnail as string,
      /\/w_320,h_320,fit_inside,f_webp,fp_0.5_0.5\/photos\/sunset\.jpg$/,
    );
    const document: Record<string, unknown> = {
      directory: '',
      name: 'report.pdf',
      type: 'application/pdf',
    };
    decorateUpload(document);
    strictEqual(document.thumbnail, undefined);
    useEnv().unset('IMAGES_SECRET');
    const plain: Record<string, unknown> = { ...sunset };
    decorateUpload(plain);
    strictEqual(plain.thumbnail, undefined);
  });
});

describe('isOptimizableImage', () => {
  it('knows the types the service renders', () => {
    strictEqual(isOptimizableImage('image/png'), true);
    strictEqual(isOptimizableImage('image/svg+xml; charset=utf-8'), true);
    strictEqual(isOptimizableImage('image/heic'), false);
    strictEqual(isOptimizableImage('application/pdf'), false);
  });
});
