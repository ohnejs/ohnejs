import { strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { before, describe, it, mock } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import { loadLanguage } from '../../../../src/dashboard/runtime/messages.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { baseBrowser } from '../../../base/dashboard/_browser.ts';
import { type FakeElement, findElement } from '../../../dashboard/_fake-dom.ts';

type MediaImageItem =
  typeof import('../../../../src/uploads/dashboard/components/media-image-item.ts');
type MediaState =
  typeof import('../../../../src/uploads/dashboard/components/media-library-state.ts');

const base = new URL('../../../../src/base/dashboard/', import.meta.url);

registerHooks({
  resolve: (specifier, context, next) =>
    next(
      specifier.startsWith('app/') ? new URL(specifier.slice(4), base).href : specifier,
      context,
    ),
});

describe('mediaImageItem', () => {
  let mediaImageItem!: MediaImageItem['mediaImageItem'];
  let createMediaView!: MediaState['createMediaView'];

  before(async () => {
    baseBrowser('/media');
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async () => new Response('{}'));
    await loadLanguage('en');
    ({ mediaImageItem } =
      await import('../../../../src/uploads/dashboard/components/media-image-item.ts'));
    ({ createMediaView } =
      await import('../../../../src/uploads/dashboard/components/media-library-state.ts'));
  });

  const loadingOf = (lazy?: boolean): string | null => {
    const record = {
      UUID: 'a',
      kind: 'file',
      name: 'citadel.png',
      path: '',
      type: 'image/png',
      size: 10,
      width: 2,
      height: 2,
    } as unknown as UploadRecord;
    const root = mediaImageItem(() => record, {
      view: createMediaView(),
      ...(lazy === undefined ? {} : { lazy }),
    }) as unknown as FakeElement;
    flush();
    return (
      findElement(root, (element) => element.tagName === 'IMG')?.getAttribute('loading') ?? null
    );
  };

  it('loads its thumbnail lazily by default, and eagerly when a field asks', () => {
    strictEqual(loadingOf(), 'lazy');
    strictEqual(loadingOf(false), 'eager');
  });
});
