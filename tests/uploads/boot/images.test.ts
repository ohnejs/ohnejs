import { match, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import '../../../src/uploads/boot/images.ts';
import '../_fixture.ts';

/**
 * Runs the ready hook and returns what the printer wrote.
 */
async function readyOutput(): Promise<string> {
  let written = '';
  usePrinter().configure({ stream: { write: (chunk: string) => ((written += chunk), true) } });
  try {
    await applyHook('server:ready', { host: 'localhost', port: 0 });
  } finally {
    usePrinter().configure({ stream: { write: () => true } });
  }
  return written;
}

describe('the images boot file', () => {
  afterEach(() => {
    useLayers().remove('/images-boot-test');
    useEnv().unset('IMAGES_SECRET');
  });

  it('warns when a service is configured without a secret', async () => {
    useLayers().add({
      path: '/images-boot-test',
      input: { uploads: { images: { url: 'https://img.example.com' } } },
    });
    match(await readyOutput(), /IMAGES_SECRET/);
  });

  it('stays silent with a secret or without a service', async () => {
    strictEqual(await readyOutput(), '');
    useLayers().add({
      path: '/images-boot-test',
      input: { uploads: { images: { url: 'https://img.example.com' } } },
    });
    useEnv().set('IMAGES_SECRET', 'secret');
    strictEqual(await readyOutput(), '');
  });
});
