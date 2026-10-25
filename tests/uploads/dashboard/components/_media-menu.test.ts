import { deepStrictEqual, strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { before, describe, it, mock } from 'node:test';

import type { MenuAction, MenuGroup } from '../../../../src/dashboard/ui/menu.ts';
import type { UploadsPermissions } from '../../../../src/uploads/dashboard/components/_permissions.ts';
import type { MediaView } from '../../../../src/uploads/dashboard/components/media-library-state.ts';
import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import { compact } from '../../../../src/utils/array/compact.ts';
import { baseBrowser } from '../../../base/dashboard/_browser.ts';

type MediaMenu = typeof import('../../../../src/uploads/dashboard/components/_media-menu.ts');
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

const ALL: UploadsPermissions = {
  canUpload: true,
  canFetch: true,
  canCreateFolder: true,
  canReplace: true,
  canEdit: true,
  canMove: true,
  canSetPrivate: true,
  canDelete: true,
  canLink: true,
};

const upload = (UUID: string, extra: Partial<UploadRecord> = {}): UploadRecord =>
  ({
    UUID,
    kind: 'file',
    name: `${UUID}.png`,
    path: `${UUID}.png`,
    directory: '',
    ...extra,
  }) as UploadRecord;

const NONE: UploadsPermissions = {
  ...ALL,
  canEdit: false,
  canMove: false,
  canSetPrivate: false,
  canDelete: false,
};

const action = (groups: readonly MenuGroup[], label: string): MenuAction =>
  compact(groups.flat()).find((item) => item.label === label)!;

const uuids = (records: readonly UploadRecord[]): string[] => records.map((record) => record.UUID);

describe('mediaMenu', () => {
  let mediaMenu!: MediaMenu['mediaMenu'];
  let createMediaView!: MediaState['createMediaView'];
  let shapeOf!: (groups: readonly MenuGroup[]) => string;

  before(async () => {
    baseBrowser('/media');
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({ apiURL: 'http://api', defaultLanguage: 'en' }),
      }),
    });
    ({ mediaMenu } = await import('../../../../src/uploads/dashboard/components/_media-menu.ts'));
    ({ createMediaView } =
      await import('../../../../src/uploads/dashboard/components/media-library-state.ts'));
    ({ shapeOf } = await import('../../../dashboard/ui/_menu-shape.ts'));
  });

  const viewOf = (...records: UploadRecord[]): MediaView => {
    const view = createMediaView();
    view.uploads.value = records;
    return view;
  };

  const open = (
    record: UploadRecord,
    view: MediaView,
    extra: Partial<Parameters<MediaMenu['mediaMenu']>[1]> = {},
  ): MenuGroup[] =>
    mediaMenu(record, {
      view,
      permissions: ALL,
      actions: { onRename() {}, onMove() {}, onDetails() {} },
      selectable: () => true,
      ...extra,
    });

  it('acts on an unselected record alone, leaving the selection as it is', () => {
    const [dawn, dusk, noon] = [upload('dawn'), upload('dusk'), upload('noon')];
    const view = viewOf(dawn, dusk, noon);
    view.select(dawn);
    view.select(dusk);
    const onMove = mock.fn((_records: readonly UploadRecord[]) => {});
    const items = open(noon, view, { actions: { onRename() {}, onMove, onDetails() {} } });
    action(items, 'uploads.dashboard.move').onSelect?.();
    deepStrictEqual(
      [
        uuids(view.selection.value),
        uuids(onMove.mock.calls[0]?.arguments[0] ?? []),
        shapeOf(items).includes('uploads.dashboard.rename'),
        action(items, 'dashboard.delete').hotkey,
      ],
      [['dawn', 'dusk'], ['noon'], true, undefined],
    );
  });

  it('keeps the selection when the record is in it, and acts on all of it', () => {
    const [dawn, dusk] = [upload('dawn'), upload('dusk')];
    const view = viewOf(dawn, dusk);
    view.select(dawn);
    view.select(dusk);
    const onMove = mock.fn((_records: readonly UploadRecord[]) => {});
    const items = open(dusk, view, { actions: { onRename() {}, onMove, onDetails() {} } });
    action(items, 'uploads.dashboard.move').onSelect?.();
    deepStrictEqual(
      [uuids(view.selection.value), uuids(onMove.mock.calls[0]?.arguments[0] ?? [])],
      [
        ['dawn', 'dusk'],
        ['dawn', 'dusk'],
      ],
    );
  });

  it('opens a folder in place, or in a new tab', () => {
    const folder = upload('trips', { kind: 'folder', path: 'trips' });
    const items = open(folder, viewOf(folder));
    const tab = action(items, 'dashboard.openInNewTab');
    deepStrictEqual(
      [action(items, 'dashboard.open').href, tab.href, tab.target],
      ['/media/trips', '/media/trips', '_blank'],
    );
  });

  it('opens a file in a new tab at its own URL', () => {
    const dawn = upload('dawn', { url: '/uploads/dawn.png' });
    const tab = action(open(dawn, viewOf(dawn)), 'dashboard.openInNewTab');
    deepStrictEqual([tab.href, tab.target], ['http://api/uploads/dawn.png', '_blank']);
  });

  it('counts the records the delete row takes from a selection of several', () => {
    const [dawn, dusk, noon] = [upload('dawn'), upload('dusk'), upload('noon')];
    const view = viewOf(dawn, dusk, noon);
    for (const record of [dawn, dusk, noon]) view.select(record);
    const [remove] = compact(open(dawn, view).at(-1)!);
    deepStrictEqual(
      [remove?.label, remove?.icon, remove?.destructive],
      [{ key: 'uploads.dashboard.deleteCount', params: { count: 3 } }, 'trash-x', true],
    );
  });

  it('offers both privacy rows for a mixed selection, each for the records it changes', async () => {
    const records = [
      upload('open'),
      upload('locked', { private: true }),
      upload('vaulted', { private: true, directory: 'vault' }),
    ];
    const view = viewOf(...records);
    view.privateFolders.value = new Set(['vault']);
    for (const record of records) view.select(record);
    const bodies: unknown[] = [];
    const fetch = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    });
    const items = open(records[0]!, view);
    action(items, 'uploads.dashboard.makePrivate').onSelect?.();
    action(items, 'uploads.dashboard.makePublic').onSelect?.();
    await new Promise((resolve) => setTimeout(resolve));
    fetch.mock.restore();
    deepStrictEqual(bodies, [
      { uuids: ['open'], private: true },
      { uuids: ['locked'], private: false },
    ]);
  });

  it('labels the delete row with the hotkey that deletes the selection', () => {
    const dawn = upload('dawn');
    const view = viewOf(dawn);
    view.select(dawn);
    strictEqual(action(open(dawn, view), 'dashboard.delete').hotkey, 'delete');
  });

  it('selects a record outside the selection, deselects a lone one, and clears several', () => {
    const [dawn, dusk, noon] = [upload('dawn'), upload('dusk'), upload('noon')];
    const view = viewOf(dawn, dusk, noon);
    view.select(dawn);
    action(open(noon, view), 'dashboard.select').onSelect?.();
    const afterSelect = uuids(view.selection.value);
    action(open(dawn, view), 'dashboard.clearSelection').onSelect?.();
    const afterClear = uuids(view.selection.value);
    view.select(dusk);
    action(open(dusk, view), 'dashboard.deselect').onSelect?.();
    deepStrictEqual(
      [afterSelect, afterClear, uuids(view.selection.value)],
      [['dawn', 'noon'], [], []],
    );
  });

  it('gates each row on its action', () => {
    const view = viewOf(upload('dawn'));
    const items = open(upload('dawn'), view, { actions: {} });
    strictEqual(
      shapeOf(items),
      'uploads.dashboard.details, dashboard.openInNewTab, uploads.dashboard.makePrivate' +
        ' | dashboard.select | dashboard.delete',
    );
  });
});

describe('mediaMenu rows by permission', () => {
  let mediaMenu!: MediaMenu['mediaMenu'];
  let createMediaView!: MediaState['createMediaView'];
  let shapeOf!: (groups: readonly MenuGroup[]) => string;

  before(async () => {
    ({ mediaMenu } = await import('../../../../src/uploads/dashboard/components/_media-menu.ts'));
    ({ createMediaView } =
      await import('../../../../src/uploads/dashboard/components/media-library-state.ts'));
    ({ shapeOf } = await import('../../../dashboard/ui/_menu-shape.ts'));
  });

  const ITEM = 'dashboard.openInNewTab';
  const FOLDER = `dashboard.open, ${ITEM}`;
  const FILE = `uploads.dashboard.details, ${ITEM}`;
  const RENAME = 'uploads.dashboard.rename';
  const MOVE = 'uploads.dashboard.move';
  const PRIVATE = 'uploads.dashboard.makePrivate';
  const PUBLIC = 'uploads.dashboard.makePublic';
  const SELECT = 'dashboard.select';
  const DESELECT = 'dashboard.deselect';
  const CLEAR = 'dashboard.clearSelection';
  const DELETE = 'dashboard.delete';
  const DELETE_MANY = 'uploads.dashboard.deleteCount[delete]';

  const shape = (
    permissions: UploadsPermissions,
    records: UploadRecord[],
    selected: UploadRecord[] = [],
    selectable = true,
  ): string => {
    const view = createMediaView();
    view.uploads.value = records;
    view.privateFolders.value = new Set(['vault']);
    for (const record of selected) view.select(record);
    const { canMove, canSetPrivate, canDelete } = permissions;
    return shapeOf(
      mediaMenu(records[0]!, {
        view,
        permissions,
        actions: { onRename() {}, onMove() {}, onDetails() {} },
        selectable: () => (canMove || canSetPrivate || canDelete) && selectable,
      }),
    );
  };

  const rights: [string, Partial<UploadsPermissions>][] = [
    ['none', {}],
    ['edit', { canEdit: true }],
    ['move', { canMove: true }],
    ['private', { canSetPrivate: true }],
    ['delete', { canDelete: true }],
    ['edit, move, and private', { canEdit: true, canMove: true, canSetPrivate: true }],
    ['every right', { canEdit: true, canMove: true, canSetPrivate: true, canDelete: true }],
  ];

  const unselected: Record<string, string> = {
    none: '',
    edit: `, ${RENAME}`,
    move: `, ${MOVE} | ${SELECT}`,
    private: `, ${PRIVATE} | ${SELECT}`,
    delete: ` | ${SELECT} | ${DELETE}`,
    'edit, move, and private': `, ${RENAME}, ${MOVE}, ${PRIVATE} | ${SELECT}`,
    'every right': `, ${RENAME}, ${MOVE}, ${PRIVATE} | ${SELECT} | ${DELETE}`,
  };

  for (const [name, granted] of rights) {
    it(`renders an unselected folder and file for ${name}`, () => {
      const permissions = { ...NONE, ...granted };
      const folder = upload('trips', { kind: 'folder', path: 'trips' });
      deepStrictEqual(
        [shape(permissions, [folder]), shape(permissions, [upload('dawn')])],
        [FOLDER + unselected[name], FILE + unselected[name]],
      );
    });
  }

  it('leaves out select for a record that may not join the selection', () => {
    strictEqual(
      shape(ALL, [upload('dawn')], [], false),
      `${FILE}, ${RENAME}, ${MOVE}, ${PRIVATE} | ${DELETE}`,
    );
  });

  it('renders a file selected alone with every right', () => {
    const dawn = upload('dawn');
    strictEqual(
      shape(ALL, [dawn], [dawn]),
      `${FILE}, ${RENAME}, ${MOVE}, ${PRIVATE} | ${DESELECT} | ${DELETE}[delete]`,
    );
  });

  const several = (): UploadRecord[] => [
    upload('open'),
    upload('locked', { private: true }),
    upload('vaulted', { private: true, directory: 'vault' }),
  ];

  const pinnedSeveral = (): UploadRecord[] => [
    upload('dawn', { private: true, directory: 'vault' }),
    upload('dusk', { private: true, directory: 'vault' }),
    upload('noon', { private: true, directory: 'vault' }),
  ];

  const publicSeveral = (): UploadRecord[] => [upload('dawn'), upload('dusk'), upload('noon')];

  const selections: [string, UploadsPermissions, () => UploadRecord[], string][] = [
    [
      'every right, mixed privacy',
      ALL,
      several,
      `${MOVE}, ${PRIVATE}, ${PUBLIC} | ${CLEAR} | ${DELETE_MANY}`,
    ],
    [
      'move and private',
      { ...NONE, canMove: true, canSetPrivate: true },
      publicSeveral,
      `${MOVE}, ${PRIVATE} | ${CLEAR}`,
    ],
    ['private only, all pinned', { ...NONE, canSetPrivate: true }, pinnedSeveral, CLEAR],
    ['delete only', { ...NONE, canDelete: true }, several, `${CLEAR} | ${DELETE_MANY}`],
  ];

  for (const [name, permissions, records, expected] of selections) {
    it(`renders a selection of 3 for ${name}`, () => {
      const all = records();
      strictEqual(shape(permissions, all, all), expected);
    });
  }
});
