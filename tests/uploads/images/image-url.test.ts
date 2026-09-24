import { deepStrictEqual, match, strictEqual, throws } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import {
  imageSrcSet,
  imageURL,
  imageVariantURLs,
  isOptimizableImage,
} from '../../../src/uploads/images/image-url.ts';
import { decorateUpload } from '../../../src/uploads/uploads/decorate.ts';
import { signUploadLink } from '../../../src/uploads/uploads/sign.ts';
import '../_fixture.ts';

const SERVICE = 'https://img.example.com/';

const sunset = { directory: 'photos', name: 'sunset.jpg', type: 'image/jpeg' };
const locked = { ...sunset, private: true, expires: 1_700_000_000_000 };

const variants = {
  card: { width: 400, format: 'webp' },
  cardWide: { width: 800, format: 'webp' },
} as const;

describe('imageURL', () => {
  beforeEach(() => {
    useLayers().add({
      path: '/images-test',
      input: { uploads: { images: { url: SERVICE, variants } } },
    });
    useEnv().set('UPLOADS_SECRET', 'secret');
  });

  afterEach(() => {
    useLayers().remove('/images-test');
    useEnv().unset('UPLOADS_SECRET');
  });

  it('signs a variant under the service origin', () => {
    strictEqual(
      imageURL(sunset, { width: 800, format: 'webp' }),
      'https://img.example.com/2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck/w_800,f_webp/photos/sunset.jpg',
    );
  });

  it('resolves a name to the same URL as its transforms', () => {
    strictEqual(
      imageURL(sunset, 'thumbnail'),
      imageURL(sunset, { width: 320, height: 320, fit: 'inside', format: 'webp' }),
    );
    match(imageURL(sunset, 'card'), /\/w_400,f_webp\/photos\/sunset\.jpg$/);
  });

  it('throws for an unknown name, with or without a service', () => {
    throws(() => imageURL(sunset, 'hero'), /Unknown image variant `hero`/);
    useLayers().remove('/images-test');
    throws(() => imageURL(sunset, 'hero'), /`uploads\.images\.variants`/);
  });

  it('fills the focal point from the upload only when a cover fit names no position', () => {
    const focused = { ...sunset, focalX: 0.25, focalY: 1 };
    match(imageURL(focused, { width: 800 }), /\/w_800,fp_0.25_1\/photos\/sunset.jpg$/);
    match(
      imageURL(focused, { width: 800, fit: 'cover' }),
      /\/w_800,fp_0.25_1\/photos\/sunset.jpg$/,
    );
    match(imageURL(focused, { width: 800, position: 'top' }), /\/w_800,p_top\/photos\/sunset.jpg$/);
    match(
      imageURL(focused, { width: 800, fit: 'inside' }),
      /\/w_800,fit_inside\/photos\/sunset.jpg$/,
    );
    match(
      imageURL(focused, { width: 800, fit: 'contain' }),
      /\/w_800,fit_contain\/photos\/sunset.jpg$/,
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

  it('writes unsigned without a secret and answers the original without a service', () => {
    useEnv().unset('UPLOADS_SECRET');
    strictEqual(
      imageURL(sunset, { width: 800 }),
      'https://img.example.com/unsigned/w_800/photos/sunset.jpg',
    );
    useEnv().set('UPLOADS_SECRET', 'secret');
    useLayers().remove('/images-test');
    strictEqual(imageURL(sunset, 'thumbnail'), '/uploads/photos/sunset.jpg');
  });

  it('builds a srcset from names or transforms, the width as the descriptor', () => {
    const byName = imageSrcSet(sunset, ['card', 'cardWide']);
    match(
      byName,
      /^https:\/\/img\.example\.com\/[A-Za-z0-9_-]{43}\/w_400,f_webp\/photos\/sunset\.jpg 400w, https:\/\/img\.example\.com\/[A-Za-z0-9_-]{43}\/w_800,f_webp\/photos\/sunset\.jpg 800w$/,
    );
    strictEqual(imageSrcSet(sunset, [variants.card, variants.cardWide]), byName);
    strictEqual(imageSrcSet(sunset, ['card', { width: 800, format: 'webp' }]), byName);
  });

  it('refuses a srcset entry without a width', () => {
    throws(() => imageSrcSet(sunset, [{ format: 'webp' }]), /`srcset` entry has no `width`/);
    useLayers().add({
      path: '/images-test-no-width',
      input: { uploads: { images: { variants: { noWidth: { format: 'webp' } } } } },
    });
    try {
      throws(() => imageSrcSet(sunset, ['noWidth']), /Image variant `noWidth` has no `width`/);
    } finally {
      useLayers().remove('/images-test-no-width');
    }
  });

  it('signs one URL per configured variant', () => {
    const urls = imageVariantURLs(sunset);
    deepStrictEqual(Object.keys(urls).sort(), ['card', 'cardWide', 'thumbnail']);
    strictEqual(urls.thumbnail, imageURL(sunset, 'thumbnail'));
    strictEqual(urls.card, imageURL(sunset, 'card'));
  });

  it('decorates a read with variants only when it can render them', () => {
    const image: Record<string, unknown> = { ...sunset, private: false, focalX: 0.5, focalY: 0.5 };
    decorateUpload(image);
    const urls = image.variants as Record<string, string>;
    match(urls.thumbnail, /\/w_320,h_320,fit_inside,f_webp\/photos\/sunset\.jpg$/);
    match(urls.cardWide, /\/w_800,f_webp,fp_0.5_0.5\/photos\/sunset\.jpg$/);
    const document: Record<string, unknown> = {
      directory: '',
      name: 'report.pdf',
      type: 'application/pdf',
      private: false,
    };
    decorateUpload(document);
    strictEqual(document.variants, undefined);
    useEnv().unset('UPLOADS_SECRET');
    const plain: Record<string, unknown> = { ...sunset, private: false };
    decorateUpload(plain);
    match(
      (plain.variants as Record<string, string>).thumbnail,
      /^https:\/\/img\.example\.com\/unsigned\//,
    );
  });

  it('appends the expiry token last and signs it for a private image', () => {
    strictEqual(
      imageURL(locked, { width: 800, format: 'webp' }),
      'https://img.example.com/lznJAVjMklhx4zqJ2JblQECAwz3_EDRvDnho4upa-YA/w_800,f_webp,e_1700000000000/photos/sunset.jpg',
    );
    strictEqual(
      imageURL(locked, 'thumbnail'),
      'https://img.example.com/lGRnq9fg9PPUiyh0eMQFCDjvCOUJ9kxgDzs_0_qpV-I/w_320,h_320,fit_inside,f_webp,e_1700000000000/photos/sunset.jpg',
    );
    match(
      imageURL({ ...locked, focalX: 0.25, focalY: 1 }, { width: 800, dpr: 2 }),
      /\/w_800,fp_0.25_1,dpr_2,e_1700000000000\/photos\/sunset\.jpg$/,
    );
  });

  it('never writes unsigned for a private image', () => {
    useEnv().unset('UPLOADS_SECRET');
    strictEqual(imageURL(locked, { width: 800 }), '/uploads/photos/sunset.jpg');
  });

  it('points a private image without an expiry at the bare original, else at its signed link', () => {
    strictEqual(
      imageURL({ ...sunset, private: true }, { width: 800 }),
      '/uploads/photos/sunset.jpg',
    );
    strictEqual(
      imageURL(locked),
      `/uploads/photos/sunset.jpg?e=1700000000000&s=${signUploadLink('photos/sunset.jpg', 1_700_000_000_000, 'secret')}`,
    );
  });

  it('carries a private source through srcset and the variant map', () => {
    match(
      imageSrcSet(locked, ['card']),
      /\/w_400,f_webp,e_1700000000000\/photos\/sunset\.jpg 400w$/,
    );
    strictEqual(imageVariantURLs(locked).card, imageURL(locked, 'card'));
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
