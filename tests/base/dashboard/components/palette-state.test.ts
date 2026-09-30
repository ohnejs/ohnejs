import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  closePalette,
  movePaletteActive,
  openPalette,
  paletteActive,
  paletteGroups,
  paletteHits,
  paletteOpen,
  paletteQuery,
  paletteSearchTerm,
  paletteView,
} from '../../../../src/base/dashboard/components/palette-state.ts';
import { effect } from '../../../../src/utils/index.ts';

const COLLECTIONS = [
  { name: 'Items', label: 'Items', segment: 'items' },
  { name: 'Characters', label: 'Characters', segment: 'characters' },
];

const MENU = [
  { label: '', items: [{ to: '/', label: 'Overview' }] },
  {
    label: 'Collections',
    items: [
      { to: '/collections/items', label: 'Items' },
      { to: '/collections/characters', label: 'Characters' },
    ],
  },
];

describe('paletteGroups', () => {
  it('lists every menu row for a blank query, numbering rows across groups', () => {
    deepStrictEqual(paletteGroups('', [], COLLECTIONS, MENU), [
      { key: 'menu:0', label: '', entries: [{ index: 0, label: 'Overview', to: '/' }] },
      {
        key: 'menu:1',
        label: 'Collections',
        entries: [
          { index: 1, label: 'Items', to: '/collections/items' },
          { index: 2, label: 'Characters', to: '/collections/characters' },
        ],
      },
    ]);
  });

  it('groups hits by collection in arrival order, ahead of the matching menu rows', () => {
    const hits = [
      { collection: 'Items', UUID: 'a', label: 'Ashbringer' },
      { collection: 'Characters', UUID: 'b', label: 'Ash' },
      { collection: 'Items', UUID: 'c', label: 'Ashen helm' },
    ];
    deepStrictEqual(paletteGroups('ash', hits, COLLECTIONS, MENU), [
      {
        key: 'collection:Items',
        label: 'Items',
        entries: [
          { index: 0, label: 'Ashbringer', to: '/collections/items/a' },
          { index: 1, label: 'Ashen helm', to: '/collections/items/c' },
        ],
      },
      {
        key: 'collection:Characters',
        label: 'Characters',
        entries: [{ index: 2, label: 'Ash', to: '/collections/characters/b' }],
      },
    ]);
  });

  it("links a hit to its collection's recordPath when one is declared", () => {
    const media = {
      name: 'Uploads',
      label: 'Uploads',
      segment: 'uploads',
      recordPath: '/media?details=[uuid]',
    };
    const hits = [{ collection: 'Uploads', UUID: 'u', label: 'sunset.jpg' }];
    deepStrictEqual(paletteGroups('sun', hits, [media], []), [
      {
        key: 'collection:Uploads',
        label: 'Uploads',
        entries: [{ index: 0, label: 'sunset.jpg', to: '/media?details=u' }],
      },
    ]);
  });

  it('keeps the menu rows matching every word, and drops a hit of an unlisted collection', () => {
    const hits = [{ collection: 'Secrets', UUID: 's', label: 'Items vault' }];
    deepStrictEqual(paletteGroups('ITEMS', hits, COLLECTIONS, MENU), [
      {
        key: 'menu:1',
        label: 'Collections',
        entries: [{ index: 0, label: 'Items', to: '/collections/items' }],
      },
    ]);
  });

  it("numbers a layer's rows after the menu rows, keeping their icon and action", () => {
    const onSelect = (): void => {};
    const rows = [
      {
        key: 'ai:ask',
        label: '',
        rows: [{ label: 'Ask: items', icon: 'sparkles' as const, onSelect }],
      },
    ];
    deepStrictEqual(paletteGroups('items', [], COLLECTIONS, MENU, rows), [
      {
        key: 'menu:1',
        label: 'Collections',
        entries: [{ index: 0, label: 'Items', to: '/collections/items' }],
      },
      {
        key: 'ai:ask',
        label: '',
        entries: [{ index: 1, label: 'Ask: items', icon: 'sparkles', onSelect }],
      },
    ]);
  });

  it("answers a command with the layers' rows alone", () => {
    const hits = [{ collection: 'Items', UUID: 'a', label: 'Items vault' }];
    const onSelect = (): void => {};
    const rows = [{ key: 'ai:skill', label: 'Skills', rows: [{ label: 'Tidy', onSelect }] }];
    deepStrictEqual(paletteGroups(' /items', hits, COLLECTIONS, MENU, rows), [
      { key: 'ai:skill', label: 'Skills', entries: [{ index: 0, label: 'Tidy', onSelect }] },
    ]);
  });
});

describe('the palette store', () => {
  it('opens on a blank search and closes', () => {
    paletteView.value = 'turn';
    paletteQuery.value = 'stale';
    paletteHits.value = [{ collection: 'Items', UUID: 'a', label: 'A' }];
    paletteActive.value = 3;
    openPalette();
    strictEqual(paletteOpen.value, true);
    strictEqual(paletteView.value, 'search');
    strictEqual(paletteQuery.value, '');
    deepStrictEqual(paletteHits.value, []);
    strictEqual(paletteActive.value, 0);
    closePalette();
    strictEqual(paletteOpen.value, false);
  });

  it('moves the selection, wrapping at either end', () => {
    paletteActive.value = 0;
    movePaletteActive(-1, 3);
    strictEqual(paletteActive.value, 2);
    movePaletteActive(1, 3);
    strictEqual(paletteActive.value, 0);
    movePaletteActive(1, 0);
    strictEqual(paletteActive.value, 0);
  });

  it('searches the trimmed query only while the search view shows', () => {
    const seen: string[] = [];
    paletteView.value = 'search';
    paletteQuery.value = '  ash ';
    const stop = effect(() => void seen.push(paletteSearchTerm()));
    paletteView.value = 'turn';
    paletteQuery.value = 'retire every character';
    paletteQuery.value = 'ash';
    paletteView.value = 'search';
    stop();
    deepStrictEqual(seen, ['ash', '', 'ash']);
  });

  it('never searches a command', () => {
    paletteView.value = 'search';
    paletteQuery.value = '/translate-items into German';
    strictEqual(paletteSearchTerm(), '');
    paletteQuery.value = '';
  });
});
