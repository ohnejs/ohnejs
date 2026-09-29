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
  paletteView,
} from '../../../../src/base/dashboard/components/palette-state.ts';

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
});
