import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  closePalette,
  movePaletteActive,
  openPalette,
  paletteActive,
  paletteActiveIndex,
  paletteGroups,
  paletteHits,
  paletteOpen,
  paletteQuery,
  paletteSearchTerm,
  paletteView,
  resetPalette,
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
      { key: 'menu:0', label: '', entries: [{ key: 'menu:0\n/', label: 'Overview', to: '/' }] },
      {
        key: 'menu:1',
        label: 'Collections',
        entries: [
          { key: 'menu:1\n/collections/items', label: 'Items', to: '/collections/items' },
          {
            key: 'menu:1\n/collections/characters',
            label: 'Characters',
            to: '/collections/characters',
          },
        ],
      },
    ]);
  });

  it("lists a layer's rows ahead of the menu for a blank query, and after it for a typed one", () => {
    const rows = [{ key: 'ai:ask', label: '', rows: [{ label: 'Assistant', onSelect: () => {} }] }];
    const keys = (query: string) =>
      paletteGroups(query, [], COLLECTIONS, MENU, rows).map((group) => group.key);
    deepStrictEqual(keys(''), ['ai:ask', 'menu:0', 'menu:1']);
    deepStrictEqual(keys('items'), ['menu:1', 'ai:ask']);
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
          {
            key: 'collection:Items\n/collections/items/a',
            label: 'Ashbringer',
            to: '/collections/items/a',
          },
          {
            key: 'collection:Items\n/collections/items/c',
            label: 'Ashen helm',
            to: '/collections/items/c',
          },
        ],
      },
      {
        key: 'collection:Characters',
        label: 'Characters',
        entries: [
          {
            key: 'collection:Characters\n/collections/characters/b',
            label: 'Ash',
            to: '/collections/characters/b',
          },
        ],
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
        entries: [
          {
            key: 'collection:Uploads\n/media?details=u',
            label: 'sunset.jpg',
            to: '/media?details=u',
          },
        ],
      },
    ]);
  });

  it('keeps the menu rows matching every word, and drops a hit of an unlisted collection', () => {
    const hits = [{ collection: 'Secrets', UUID: 's', label: 'Items vault' }];
    deepStrictEqual(paletteGroups('ITEMS', hits, COLLECTIONS, MENU), [
      {
        key: 'menu:1',
        label: 'Collections',
        entries: [{ key: 'menu:1\n/collections/items', label: 'Items', to: '/collections/items' }],
      },
    ]);
  });

  it("keys a layer's rows after the menu rows, keeping their icon and action", () => {
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
        entries: [{ key: 'menu:1\n/collections/items', label: 'Items', to: '/collections/items' }],
      },
      {
        key: 'ai:ask',
        label: '',
        entries: [{ key: 'ai:ask\nAsk: items', label: 'Ask: items', icon: 'sparkles', onSelect }],
      },
    ]);
  });

  it('ends a hit group that may go on in a row loading its next hits', () => {
    const hits = [
      { collection: 'Items', UUID: 'a', label: 'Ashbringer' },
      { collection: 'Characters', UUID: 'b', label: 'Ash' },
    ];
    const loaded: string[] = [];
    const more = {
      collections: new Set(['Items']),
      label: 'Load more',
      load: (name: string) => void loaded.push(name),
    };
    const [items, characters] = paletteGroups('ash', hits, COLLECTIONS, MENU, [], more);
    deepStrictEqual(
      items.entries.map((entry) => entry.label),
      ['Ashbringer', 'Load more'],
    );
    deepStrictEqual(
      characters.entries.map((entry) => entry.label),
      ['Ash'],
    );
    items.entries[1].onSelect?.();
    deepStrictEqual(loaded, ['Items']);
  });

  it("answers a command with the layers' rows alone", () => {
    const hits = [{ collection: 'Items', UUID: 'a', label: 'Items vault' }];
    const onSelect = (): void => {};
    const rows = [{ key: 'ai:skill', label: 'Skills', rows: [{ label: 'Tidy', onSelect }] }];
    deepStrictEqual(paletteGroups(' /items', hits, COLLECTIONS, MENU, rows), [
      {
        key: 'ai:skill',
        label: 'Skills',
        entries: [{ key: 'ai:skill\nTidy', label: 'Tidy', onSelect }],
      },
    ]);
  });
});

describe('the palette store', () => {
  it('opens where the person left it, and resets to a blank search', () => {
    paletteView.value = 'turn';
    paletteQuery.value = 'stale';
    paletteHits.value = [{ collection: 'Items', UUID: 'a', label: 'A' }];
    paletteActive.value = 'menu:0\n/';
    openPalette();
    strictEqual(paletteOpen.value, true);
    strictEqual(paletteView.value, 'turn');
    strictEqual(paletteQuery.value, 'stale');
    resetPalette();
    strictEqual(paletteView.value, 'search');
    strictEqual(paletteQuery.value, '');
    deepStrictEqual(paletteHits.value, []);
    strictEqual(paletteActive.value, '');
    closePalette();
    strictEqual(paletteOpen.value, false);
  });

  it('moves the selection, wrapping at either end', () => {
    const entries = paletteGroups('', [], COLLECTIONS, MENU).flatMap((group) => group.entries);
    paletteActive.value = '';
    movePaletteActive(-1, entries);
    strictEqual(paletteActive.value, entries[2].key);
    movePaletteActive(1, entries);
    strictEqual(paletteActive.value, entries[0].key);
    movePaletteActive(1, []);
    strictEqual(paletteActive.value, entries[0].key);
  });

  it('keeps a picked row when hits arrive above it, and falls back to the first once it is gone', () => {
    const before = paletteGroups('item', [], COLLECTIONS, MENU).flatMap((group) => group.entries);
    paletteActive.value = '';
    movePaletteActive(1, before);
    const picked = before[paletteActiveIndex(before, paletteActive.value)];
    const hits = [{ collection: 'Items', UUID: 'a', label: 'Items vault' }];
    const after = paletteGroups('item', hits, COLLECTIONS, MENU).flatMap((group) => group.entries);
    const at = paletteActiveIndex(after, paletteActive.value);
    strictEqual(after[at].label, picked.label);
    strictEqual(at, 1);
    strictEqual(paletteActiveIndex(after, 'gone'), 0);
  });

  it('keys a repeated row apart', () => {
    const onSelect = (): void => {};
    const rows = [
      {
        key: 'ai:recent',
        label: '',
        rows: [
          { label: 'Draft', onSelect },
          { label: 'Draft', onSelect },
        ],
      },
    ];
    const [first, second] = paletteGroups('', [], [], [], rows)[0].entries;
    strictEqual(first.key === second.key, false);
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
