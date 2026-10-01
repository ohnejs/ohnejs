import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  closePalette,
  movePaletteActive,
  openPalette,
  paletteActive,
  paletteActiveIndex,
  paletteGroupKey,
  paletteGroups,
  paletteHits,
  paletteOpen,
  palettePathLabel,
  paletteQuery,
  paletteSearchTerm,
  paletteView,
  resetPalette,
} from '../../../../src/base/dashboard/components/palette-state.ts';
import { effect } from '../../../../src/utils/index.ts';

const GEAR = { name: 'item', label: 'Item', kind: 'record' };

const COLLECTIONS = [
  { name: 'Items', label: 'Items', segment: 'items', fields: [] },
  {
    name: 'Characters',
    label: 'Characters',
    segment: 'characters',
    fields: [
      { name: 'body', label: 'Body', kind: 'blocks' },
      { name: 'gear', label: 'Gear', kind: 'childMany', subfields: [GEAR] },
    ],
  },
];

const BLOCKS = [
  { name: 'Hero', label: 'Hero', fields: [{ name: 'image', label: 'Image', kind: 'record' }] },
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

const META = { collections: COLLECTIONS, menu: MENU, blocks: BLOCKS };

const NO_META = { collections: [], menu: [], blocks: [] };

const ASHBRINGER = { UUID: 'a', label: 'Ashbringer', path: 'gear.item' };

const VIA_ITEMS = { collection: 'Items', targets: [ASHBRINGER] };

const VIA_CHARACTERS = { collection: 'Characters', targets: [] };

describe('paletteGroups', () => {
  it('lists every menu row for a blank query, numbering rows across groups', () => {
    deepStrictEqual(paletteGroups('', [], META), [
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
    const keys = (query: string) => paletteGroups(query, [], META, rows).map((group) => group.key);
    deepStrictEqual(keys(''), ['ai:ask', 'menu:0', 'menu:1']);
    deepStrictEqual(keys('items'), ['menu:1', 'ai:ask']);
  });

  it('groups hits by collection in arrival order, ahead of the matching menu rows', () => {
    const hits = [
      { collection: 'Items', UUID: 'a', label: 'Ashbringer' },
      { collection: 'Characters', UUID: 'b', label: 'Ash' },
      { collection: 'Items', UUID: 'c', label: 'Ashen helm' },
    ];
    deepStrictEqual(paletteGroups('ash', hits, META), [
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
      fields: [],
    };
    const hits = [{ collection: 'Uploads', UUID: 'u', label: 'sunset.jpg' }];
    deepStrictEqual(paletteGroups('sun', hits, { collections: [media], menu: [], blocks: [] }), [
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
    deepStrictEqual(paletteGroups('ITEMS', hits, META), [
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
    deepStrictEqual(paletteGroups('items', [], META, rows), [
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
    const loaded: (string | undefined)[][] = [];
    const more = {
      groups: new Set(['collection:Items']),
      label: 'Load more',
      load: (collection: string, via?: string) => void loaded.push([collection, via]),
    };
    const [items, characters] = paletteGroups('ash', hits, META, [], more);
    deepStrictEqual(
      items.entries.map((entry) => entry.label),
      ['Ashbringer', 'Load more'],
    );
    deepStrictEqual(
      characters.entries.map((entry) => entry.label),
      ['Ash'],
    );
    items.entries[1].onSelect?.();
    deepStrictEqual(loaded, [['Items', undefined]]);
  });

  it('lists direct groups, then menu rows, then related groups, then layer rows', () => {
    const hits = [
      { collection: 'Items', UUID: 'a', label: 'Items vault' },
      { collection: 'Characters', UUID: 'b', label: 'Ash', via: VIA_ITEMS },
    ];
    const rows = [{ key: 'ai:ask', label: '', rows: [{ label: 'Assistant', onSelect: () => {} }] }];
    deepStrictEqual(
      paletteGroups('items', hits, META, rows).map((group) => group.key),
      ['collection:Items', 'menu:1', 'collection:Characters:via:Items', 'ai:ask'],
    );
  });

  it('heads a related group with both collections and hints each row with its link', () => {
    const hits = [{ collection: 'Characters', UUID: 'b', label: 'Ash', via: VIA_ITEMS }];
    deepStrictEqual(paletteGroups('ashbringer', hits, META), [
      {
        key: 'collection:Characters:via:Items',
        label: 'Characters',
        via: 'Items',
        entries: [
          {
            key: 'collection:Characters:via:Items\n/collections/characters/b',
            label: 'Ash',
            to: '/collections/characters/b',
            hint: { text: 'Ashbringer', tooltip: 'Gear > Item' },
          },
        ],
      },
    ]);
  });

  it('names every link of a related row in its tooltip, the first in its hint', () => {
    const helm = { UUID: 'h', label: 'Ash helm', path: 'body.Hero.image' };
    const again = { ...ASHBRINGER, path: 'body.Hero.image' };
    const via = { collection: 'Items', targets: [ASHBRINGER, helm, again] };
    const hits = [{ collection: 'Characters', UUID: 'b', label: 'Ash', via }];
    deepStrictEqual(paletteGroups('ash', hits, META)[0].entries[0].hint, {
      text: 'Ashbringer',
      tooltip: 'Ashbringer: Gear > Item, Body > Hero > Image\nAsh helm: Body > Hero > Image',
    });
  });

  it('shows a record once per collection, creating no group for a repeat alone', () => {
    const hits = [
      { collection: 'Characters', UUID: 'b', label: 'Ash' },
      { collection: 'Characters', UUID: 'b', label: 'Ash', via: VIA_ITEMS },
      { collection: 'Characters', UUID: 'c', label: 'Cinder', via: VIA_ITEMS },
      { collection: 'Characters', UUID: 'c', label: 'Cinder', via: VIA_CHARACTERS },
    ];
    const more = {
      groups: new Set(['collection:Characters:via:Characters']),
      label: 'Load more',
      load: () => {},
    };
    deepStrictEqual(
      paletteGroups('ash', hits, META, [], more).map((group) => [
        group.key,
        group.entries.map((entry) => entry.label),
      ]),
      [
        ['collection:Characters', ['Ash']],
        ['collection:Characters:via:Items', ['Cinder']],
      ],
    );
  });

  it('pages each related group on its own window', () => {
    const hits = [
      { collection: 'Characters', UUID: 'b', label: 'Ash' },
      { collection: 'Characters', UUID: 'c', label: 'Cinder', via: VIA_ITEMS },
    ];
    const loaded: (string | undefined)[][] = [];
    const more = {
      groups: new Set(['collection:Characters:via:Items']),
      label: 'Load more',
      load: (collection: string, via?: string) => void loaded.push([collection, via]),
    };
    const [direct, related] = paletteGroups('ash', hits, META, [], more);
    deepStrictEqual(
      direct.entries.map((entry) => entry.label),
      ['Ash'],
    );
    deepStrictEqual(
      related.entries.map((entry) => entry.label),
      ['Cinder', 'Load more'],
    );
    related.entries[1].onSelect?.();
    deepStrictEqual(loaded, [['Characters', 'Items']]);
  });

  it("answers a command with the layers' rows alone", () => {
    const hits = [{ collection: 'Items', UUID: 'a', label: 'Items vault' }];
    const onSelect = (): void => {};
    const rows = [{ key: 'ai:skill', label: 'Skills', rows: [{ label: 'Tidy', onSelect }] }];
    deepStrictEqual(paletteGroups(' /items', hits, META, rows), [
      {
        key: 'ai:skill',
        label: 'Skills',
        entries: [{ key: 'ai:skill\nTidy', label: 'Tidy', onSelect }],
      },
    ]);
  });
});

describe('paletteGroupKey', () => {
  it('keys a direct group by its collection, and a related one by both', () => {
    strictEqual(paletteGroupKey('Items'), 'collection:Items');
    strictEqual(paletteGroupKey('Characters', 'Items'), 'collection:Characters:via:Items');
  });
});

describe('palettePathLabel', () => {
  it('words a path with the field and block labels along it', () => {
    strictEqual(
      palettePathLabel('body.Hero.image', COLLECTIONS[1].fields, BLOCKS),
      'Body > Hero > Image',
    );
    strictEqual(palettePathLabel('gear.item', COLLECTIONS[1].fields, BLOCKS), 'Gear > Item');
  });

  it('keeps a segment it cannot find as written', () => {
    strictEqual(palettePathLabel('lost.Hero', COLLECTIONS[1].fields, BLOCKS), 'lost > Hero');
    strictEqual(
      palettePathLabel('body.Gone.image', COLLECTIONS[1].fields, BLOCKS),
      'Body > Gone > image',
    );
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
    const entries = paletteGroups('', [], META).flatMap((group) => group.entries);
    paletteActive.value = '';
    movePaletteActive(-1, entries);
    strictEqual(paletteActive.value, entries[2].key);
    movePaletteActive(1, entries);
    strictEqual(paletteActive.value, entries[0].key);
    movePaletteActive(1, []);
    strictEqual(paletteActive.value, entries[0].key);
  });

  it('keeps a picked row when hits arrive above it, and falls back to the first once it is gone', () => {
    const before = paletteGroups('item', [], META).flatMap((group) => group.entries);
    paletteActive.value = '';
    movePaletteActive(1, before);
    const picked = before[paletteActiveIndex(before, paletteActive.value)];
    const hits = [{ collection: 'Items', UUID: 'a', label: 'Items vault' }];
    const after = paletteGroups('item', hits, META).flatMap((group) => group.entries);
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
    const [first, second] = paletteGroups('', [], NO_META, rows)[0].entries;
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

  it('searches from the second character on', () => {
    paletteView.value = 'search';
    paletteQuery.value = ' a ';
    strictEqual(paletteSearchTerm(), '');
    paletteQuery.value = 'as';
    strictEqual(paletteSearchTerm(), 'as');
    paletteQuery.value = '';
  });

  it('never searches a command', () => {
    paletteView.value = 'search';
    paletteQuery.value = '/translate-items into German';
    strictEqual(paletteSearchTerm(), '');
    paletteQuery.value = '';
  });
});
