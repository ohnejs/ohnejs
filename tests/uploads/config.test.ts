import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useEnv } from '../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';
import {
  UPLOADS_DEFAULTS,
  useUploadsConfig,
  validateUploadsConfig,
} from '../../src/uploads/config.ts';

const PATH = '/uploads-config-test';

describe('useUploadsConfig', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('falls back to the layer defaults', () => {
    deepStrictEqual(useUploadsConfig(), UPLOADS_DEFAULTS);
  });

  it('unions variants by name and replaces a redefined preset whole', () => {
    useLayers().add({
      path: PATH,
      input: {
        uploads: { images: { variants: { thumbnail: { width: 200 }, hero: { width: 1200 } } } },
      },
    });
    deepStrictEqual(useUploadsConfig().images, {
      variants: { thumbnail: { width: 200 }, hero: { width: 1200 } },
    });
  });

  it('replaces cache rather than merging it', () => {
    useLayers().add({ path: PATH, input: { uploads: { cache: { maxAge: 60 } } } });
    deepStrictEqual(useUploadsConfig().cache, { maxAge: 60 });
  });

  it('caps an SVG at two megabytes by default', () => {
    strictEqual(useUploadsConfig().maxSVGSize, '2mb');
  });

  it('sends a resumable upload in eight-megabyte chunks within a day by default', () => {
    const { chunkSize, sessionMaxAge } = useUploadsConfig();
    deepStrictEqual({ chunkSize, sessionMaxAge }, { chunkSize: '8mb', sessionMaxAge: '1d' });
  });

  it('defaults fetch to no extra addresses and a two-minute deadline', () => {
    deepStrictEqual(useUploadsConfig().fetch, { allow: [], timeout: '2m' });
  });

  it('replaces an inherited fetch.allow and keeps the default timeout', () => {
    useLayers().add({ path: PATH, input: { uploads: { fetch: { allow: ['10.20.0.0/16'] } } } });
    useLayers().add({ path: `${PATH}/app`, input: { uploads: { fetch: { allow: ['::1/128'] } } } });
    try {
      deepStrictEqual(useUploadsConfig().fetch, { allow: ['::1/128'], timeout: '2m' });
    } finally {
      useLayers().remove(`${PATH}/app`);
    }
  });
});

describe('validateUploadsConfig', () => {
  /**
   * The block `validateUploadsConfig` throws for `uploads` config `input`, `undefined` when it passes.
   */
  function refusal(input: Record<string, unknown>): { title: string; body: string[] } | undefined {
    useLayers().add({ path: PATH, input: { uploads: input } });
    try {
      validateUploadsConfig();
      return undefined;
    } catch (error) {
      ok(isOhneError(error), String(error));
      return { title: error.title!, body: error.body as string[] };
    } finally {
      useLayers().remove(PATH);
    }
  }

  it('accepts the defaults and every well-formed value', () => {
    strictEqual(refusal({}), undefined);
    const input = {
      maxFileSize: 1024,
      maxSVGSize: '4mb',
      chunkSize: '5mb',
      privateMaxAge: '30m',
      sessionMaxAge: '2d',
      fetch: { allow: ['10.20.0.0/16', '192.0.2.7', 'fd00::/8'], timeout: 5000 },
    };
    strictEqual(refusal(input), undefined);
  });

  for (const entry of ['stormwind', '10.0.0.0/33', '::1/129', '300.1.1.1', '10.0.0.0/', '']) {
    it(`refuses the \`fetch.allow\` entry \`${entry}\`, naming it`, () => {
      deepStrictEqual(refusal({ fetch: { allow: ['127.0.0.1/32', entry] } }), {
        title: `Invalid \`uploads.fetch.allow\` entry \`${entry}\``,
        body: [
          'An entry is an IP address or a CIDR block, such as `10.20.0.0/16` or `fd00::/8`.',
          'Fix or remove it under `uploads.fetch.allow`.',
        ],
      });
    });
  }

  for (const [key, input, value] of [
    ['maxFileSize', { maxFileSize: 'lots' }, 'lots'],
    ['maxFileSize', { maxFileSize: 0 }, 0],
    ['maxSVGSize', { maxSVGSize: 'huge' }, 'huge'],
  ] as const) {
    it(`refuses a \`${key}\` of \`${value}\``, () => {
      deepStrictEqual(refusal(input), {
        title: `Invalid \`uploads.${key}\` value \`${value}\``,
        body: [
          'It is a byte size above zero, such as `2mb`, or a number of bytes.',
          `Fix it under \`uploads.${key}\`.`,
        ],
      });
    });
  }

  for (const value of ['hefty', '0mb', '63kb', 65535]) {
    it(`refuses a \`chunkSize\` of \`${value}\``, () => {
      deepStrictEqual(refusal({ chunkSize: value }), {
        title: `Invalid \`uploads.chunkSize\` value \`${value}\``,
        body: [
          'It is a byte size of `64kb` or more, such as `8mb`, or a number of bytes.',
          'Fix it under `uploads.chunkSize`.',
        ],
      });
    });
  }

  it('accepts a `chunkSize` of exactly `64kb`', () => {
    strictEqual(refusal({ chunkSize: '64kb' }), undefined);
    strictEqual(refusal({ chunkSize: 65536 }), undefined);
  });

  for (const [key, input, value] of [
    ['privateMaxAge', { privateMaxAge: 'soon' }, 'soon'],
    ['linkMaxAge', { linkMaxAge: 'always' }, 'always'],
    ['linkMaxAge', { linkMaxAge: 0 }, 0],
    ['sessionMaxAge', { sessionMaxAge: 'eventually' }, 'eventually'],
    ['sessionMaxAge', { sessionMaxAge: 0 }, 0],
    ['fetch.timeout', { fetch: { timeout: 'forever' } }, 'forever'],
    ['fetch.timeout', { fetch: { timeout: '0s' } }, '0s'],
  ] as const) {
    it(`refuses a \`${key}\` of \`${value}\``, () => {
      deepStrictEqual(refusal(input), {
        title: `Invalid \`uploads.${key}\` value \`${value}\``,
        body: [
          'It is a duration above zero, such as `2m`, or a number of milliseconds.',
          `Fix it under \`uploads.${key}\`.`,
        ],
      });
    });
  }

  it('refuses a `privateMaxAge` past half of `linkMaxAge`, and accepts half', () => {
    deepStrictEqual(refusal({ privateMaxAge: '16d' }), {
      title: 'Invalid `uploads.privateMaxAge` value `16d`',
      body: [
        'It is at most half of `uploads.linkMaxAge`, `30d`: a read link lives up to two windows.',
        'Fix it under `uploads.privateMaxAge`.',
      ],
    });
    strictEqual(refusal({ privateMaxAge: '15d' }), undefined);
    strictEqual(refusal({ privateMaxAge: '2h', linkMaxAge: '4h' }), undefined);
    strictEqual(
      refusal({ privateMaxAge: '3h', linkMaxAge: '4h' })?.body[0],
      'It is at most half of `uploads.linkMaxAge`, `4h`: a read link lives up to two windows.',
    );
  });

  it('accepts a `linkMaxAge` past `30d`, and a `privateMaxAge` to match', () => {
    strictEqual(refusal({ linkMaxAge: '90d', privateMaxAge: '45d' }), undefined);
  });
});

describe('the uploads env vars', () => {
  it('declare no CLI flag, since the CLI parses its flags before any layer loads', () => {
    strictEqual(useEnv().flag('UPLOADS_URL'), undefined);
    strictEqual(useEnv().flag('UPLOADS_SECRET'), undefined);
  });
});
