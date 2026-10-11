import { strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { before, describe, it, mock } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import { loadLanguage } from '../../../../src/dashboard/runtime/messages.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { baseBrowser } from '../../../base/dashboard/_browser.ts';
import { type FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';

type MediaItem = typeof import('../../../../src/uploads/dashboard/components/media-item.ts');
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

describe('mediaItem', () => {
  let mediaItem!: MediaItem['mediaItem'];
  let createMediaView!: MediaState['createMediaView'];

  before(async () => {
    baseBrowser('/media');
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: ['uploads'],
        }),
      }),
    });
    const catalog = {
      'uploads.dashboard.selectItem': { template: 'Select {name}', language: 'en' },
    };
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(catalog)));
    await loadLanguage('en');
    ({ mediaItem } = await import('../../../../src/uploads/dashboard/components/media-item.ts'));
    ({ createMediaView } =
      await import('../../../../src/uploads/dashboard/components/media-library-state.ts'));
  });

  it('names the selection checkbox after the file', () => {
    const record = { UUID: 'a', kind: 'file', name: 'hero.pdf', path: '' } as UploadRecord;
    const root = mediaItem(() => record, {
      view: createMediaView(),
      permissions: { canDelete: true } as Parameters<MediaItem['mediaItem']>[1]['permissions'],
    }) as unknown as FakeElement;
    flush();
    const box = findElement(root, (element) => hasClass(element, 'ohne-checkbox-button'));
    strictEqual(box?.getAttribute('aria-label'), 'Select hero.pdf');
  });
});
