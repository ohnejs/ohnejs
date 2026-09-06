import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import {
  breadcrumbsOf,
  createMediaView,
  DEFAULT_ORDER,
  directoryFromParam,
  groupUploads,
  isDisplayableImage,
  mediaGroupField,
  mediaPath,
  movePlan,
  pruneDescendants,
  rangeBetween,
  scopedWhere,
  searchKeyword,
  searchWhere,
  splitFileName,
} from '../../../../src/uploads/dashboard/components/media-library-state.ts';

function upload(path: string, kind: 'file' | 'folder' = 'file'): UploadRecord {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  return {
    UUID: path,
    kind,
    directory,
    name,
    type: kind === 'file' ? 'image/png' : null,
    size: kind === 'file' ? 1 : null,
    hash: null,
    width: null,
    height: null,
    description: null,
    focalX: null,
    focalY: null,
    author: null,
    uploadedAt: 0,
    _updatedAt: 0,
    path,
    url: `/uploads/${path}`,
  };
}

const photos = upload('photos', 'folder');
const sunset = upload('photos/sunset.png');
const dusk = upload('photos/dusk.png');
const notes = upload('notes.txt');
const archive = upload('archive', 'folder');

const uuids = (records: readonly UploadRecord[]): string[] => records.map((record) => record.UUID);

describe('media view selection', () => {
  it('appends plain picks in order and sets the origin', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(dusk);
    view.select(sunset);
    view.select(dusk);
    deepStrictEqual(uuids(view.selection.value), [dusk.UUID, sunset.UUID]);
    strictEqual(view.origin.value, sunset);
    strictEqual(view.isSelected(dusk.UUID), true);
    strictEqual(view.isSelected(notes.UUID), false);
  });

  it('ranges from the origin in visual order, reversed when the origin comes later', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(notes);
    view.select(sunset, true);
    deepStrictEqual(uuids(view.selection.value), [notes.UUID, dusk.UUID, sunset.UUID]);
  });

  it('keeps a range to the records the owner allows', () => {
    const view = createMediaView({ selectable: (record) => record.kind === 'file' });
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(sunset);
    view.select(photos, true);
    deepStrictEqual(uuids(view.selection.value), [sunset.UUID]);
  });

  it('ranges without an origin by selecting the record alone', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(dusk, true);
    deepStrictEqual(uuids(view.selection.value), [dusk.UUID]);
  });

  it('deselects plainly and forgets the origin', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(sunset);
    view.select(dusk);
    view.deselect(sunset);
    deepStrictEqual(uuids(view.selection.value), [dusk.UUID]);
    strictEqual(view.origin.value, null);
  });

  it('turns a ranged deselect on a multi-selection into a range select', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset, dusk, notes];
    view.select(photos);
    view.select(dusk);
    view.deselect(notes, true);
    deepStrictEqual(uuids(view.selection.value), [photos.UUID, dusk.UUID, notes.UUID]);
  });

  it('deselects a lone record even with the range modifier', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset];
    view.select(sunset);
    view.deselect(sunset, true);
    deepStrictEqual(view.selection.value, []);
    strictEqual(view.origin.value, null);
  });

  it('clears the selection and the origin', () => {
    const view = createMediaView();
    view.uploads.value = [photos, sunset];
    view.select(sunset);
    view.clearSelection();
    deepStrictEqual(view.selection.value, []);
    strictEqual(view.origin.value, null);
  });

  it('defaults the query and pushes into it in place', () => {
    const view = createMediaView({ directory: 'photos', query: { page: 3 } });
    strictEqual(view.directory.value, 'photos');
    const initial = view.query.value;
    deepStrictEqual(initial, { page: 3, order: [...DEFAULT_ORDER], where: undefined });
    view.push({ page: 1, where: { kind: 'file' } });
    const filtered = view.query.value;
    deepStrictEqual(filtered, { page: 1, order: [...DEFAULT_ORDER], where: { kind: 'file' } });
    view.push({ where: undefined });
    strictEqual(view.query.value.where, undefined);
  });

  it('hands a push to the owner when one is given', () => {
    const pushes: unknown[] = [];
    const view = createMediaView({ push: (patch, replace) => pushes.push([patch, replace]) });
    view.push({ page: 2 }, true);
    deepStrictEqual(pushes, [[{ page: 2 }, true]]);
    strictEqual(view.query.value.page, 1);
  });

  it('bumps the revision on refresh', () => {
    const view = createMediaView();
    view.refresh();
    view.refresh();
    strictEqual(view.revision.value, 2);
  });
});

describe('rangeBetween', () => {
  const list = [photos, sunset, dusk, notes];

  it('walks forward and backward', () => {
    deepStrictEqual(uuids(rangeBetween(list, photos.UUID, dusk.UUID)), [
      photos.UUID,
      sunset.UUID,
      dusk.UUID,
    ]);
    deepStrictEqual(uuids(rangeBetween(list, dusk.UUID, photos.UUID)), [
      dusk.UUID,
      sunset.UUID,
      photos.UUID,
    ]);
  });

  it('yields the target alone for an unknown end', () => {
    deepStrictEqual(uuids(rangeBetween(list, 'gone', sunset.UUID)), [sunset.UUID]);
    deepStrictEqual(rangeBetween(list, sunset.UUID, 'gone'), []);
  });
});

describe('paths', () => {
  it('reads a directory out of the route param', () => {
    strictEqual(directoryFromParam(undefined), '');
    strictEqual(directoryFromParam(''), '');
    strictEqual(directoryFromParam('photos/2024/'), 'photos/2024');
    strictEqual(directoryFromParam('/photos'), 'photos');
  });

  it('builds the media path', () => {
    strictEqual(mediaPath(''), '/media');
    strictEqual(mediaPath('photos/2024'), '/media/photos/2024');
    strictEqual(mediaPath('photos', '?page=2'), '/media/photos?page=2');
  });

  it('splits a directory into breadcrumbs', () => {
    deepStrictEqual(breadcrumbsOf(''), []);
    deepStrictEqual(breadcrumbsOf('photos/2024'), [
      { name: 'photos', path: 'photos' },
      { name: '2024', path: 'photos/2024' },
    ]);
  });

  it('splits a file name at its last extension', () => {
    deepStrictEqual(splitFileName('sunset.jpg'), { stem: 'sunset', extension: 'jpg' });
    deepStrictEqual(splitFileName('archive.tar.gz'), { stem: 'archive.tar', extension: 'gz' });
    deepStrictEqual(splitFileName('notes'), { stem: 'notes', extension: '' });
  });
});

describe('scopedWhere', () => {
  it('lists the direct children without a filter', () => {
    deepStrictEqual(scopedWhere('', undefined), { directory: '' });
    deepStrictEqual(scopedWhere('photos', undefined), { directory: 'photos' });
  });

  it('runs a filter over the subtree, unscoped at the root', () => {
    deepStrictEqual(scopedWhere('', { kind: 'file' }), { kind: 'file' });
    deepStrictEqual(scopedWhere('photos', { kind: 'file' }), {
      and: [
        { or: [{ directory: 'photos' }, { directory: { startsWith: 'photos/' } }] },
        { kind: 'file' },
      ],
    });
  });
});

describe('keyword search', () => {
  it('filters files by every word and reads the words back', () => {
    strictEqual(searchWhere('   '), undefined);
    const single = searchWhere(' sunset ');
    deepStrictEqual(single, { kind: 'file', name: { contains: 'sunset' } });
    strictEqual(searchKeyword(single), 'sunset');
    const many = searchWhere('sun  set');
    deepStrictEqual(many, {
      kind: 'file',
      and: [{ name: { contains: 'sun' } }, { name: { contains: 'set' } }],
    });
    strictEqual(searchKeyword(many), 'sun set');
  });

  it('reads no keyword out of any other filter', () => {
    strictEqual(searchKeyword(undefined), '');
    strictEqual(searchKeyword({ size: { atLeast: 1 } }), '');
    strictEqual(searchKeyword({ kind: 'file', size: { atLeast: 1 } }), '');
    strictEqual(searchKeyword({ kind: 'file', name: { startsWith: 'a' } }), '');
    strictEqual(searchKeyword({ kind: 'file', name: { contains: 'a' }, size: 1 }), '');
    strictEqual(
      searchKeyword({ kind: 'file', and: [{ name: { contains: 'a' } }, { size: 1 }] }),
      '',
    );
  });
});

describe('bulk plans', () => {
  it('prunes rows inside a selected folder', () => {
    deepStrictEqual(uuids(pruneDescendants([sunset, photos, notes, dusk])), [
      photos.UUID,
      notes.UUID,
    ]);
    deepStrictEqual(uuids(pruneDescendants([sunset, dusk])), [sunset.UUID, dusk.UUID]);
  });

  it('plans a move deepest first, skipping rows already there and folders moving into themselves', () => {
    deepStrictEqual(uuids(movePlan([photos, notes, sunset], 'archive')), [
      sunset.UUID,
      notes.UUID,
      photos.UUID,
    ]);
    deepStrictEqual(movePlan([sunset, dusk], 'photos'), []);
    deepStrictEqual(movePlan([photos], 'photos'), []);
    deepStrictEqual(movePlan([photos], 'photos/2024'), []);
    deepStrictEqual(uuids(movePlan([archive], 'photos')), [archive.UUID]);
  });
});

describe('isDisplayableImage', () => {
  it('admits browser-rendered image types only', () => {
    strictEqual(isDisplayableImage(sunset), true);
    strictEqual(isDisplayableImage({ ...sunset, type: 'image/tiff' }), false);
    strictEqual(isDisplayableImage({ ...sunset, type: 'video/mp4' }), false);
    strictEqual(isDisplayableImage(photos), false);
  });
});

describe('mediaGroupField', () => {
  it('takes the primary order field when the grid groups by it', () => {
    strictEqual(mediaGroupField(['-kind', 'name']), 'kind');
    strictEqual(mediaGroupField(['type']), 'type');
    strictEqual(mediaGroupField(['-directory', 'name']), 'directory');
  });

  it('ignores an order the grid does not group by', () => {
    strictEqual(mediaGroupField([]), undefined);
    strictEqual(mediaGroupField(['name', 'kind']), undefined);
    strictEqual(mediaGroupField(['-size']), undefined);
  });
});

describe('groupUploads', () => {
  it('runs neighbours sharing the field value into one group', () => {
    deepStrictEqual(
      groupUploads([photos, archive, sunset, dusk], 'kind').map(({ key, records }) => [
        key,
        uuids(records),
      ]),
      [
        ['folder', [photos.UUID, archive.UUID]],
        ['file', [sunset.UUID, dusk.UUID]],
      ],
    );
  });

  it('keys a null value as the empty string', () => {
    deepStrictEqual(
      groupUploads([photos, sunset], 'type').map(({ key }) => key),
      ['', 'image/png'],
    );
  });

  it('opens a new group for every run, so an unsorted list never merges', () => {
    deepStrictEqual(
      groupUploads([photos, sunset, archive], 'kind').map(({ key }) => key),
      ['folder', 'file', 'folder'],
    );
  });

  it('answers nothing for an empty page', () => {
    deepStrictEqual(groupUploads([], 'directory'), []);
  });
});
