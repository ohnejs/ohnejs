import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  acceptOf,
  constraintsOf,
  constraintWhere,
  type UploadSubject,
  validateUpload,
} from '../../../../src/uploads/dashboard/components/media-picker-validation.ts';

function file(overrides: Partial<UploadSubject> = {}): UploadSubject {
  return { kind: 'file', type: 'image/png', size: 2048, width: 800, height: 600, ...overrides };
}

const folder: UploadSubject = { kind: 'folder', type: null, size: null, width: null, height: null };

describe('validateUpload', () => {
  it('accepts a file within every bound', () => {
    deepStrictEqual(
      validateUpload(
        file(),
        { types: ['image'], minSize: 1024, maxSize: '1mb', minWidth: 100, maxHeight: 600 },
        true,
      ),
      { ok: true },
    );
  });

  it('rejects a folder before anything else', () => {
    deepStrictEqual(validateUpload(folder, {}, false), {
      ok: false,
      reason: { key: 'uploads.errors.notAFile' },
    });
  });

  it('requires an image on an image field whatever the types say', () => {
    deepStrictEqual(validateUpload(file({ type: 'application/pdf' }), { types: ['*'] }, true), {
      ok: false,
      reason: { key: 'uploads.errors.notAnImage' },
    });
    deepStrictEqual(validateUpload(file({ type: 'application/pdf' }), { types: ['*'] }, false), {
      ok: true,
    });
  });

  it('matches the types as patterns and names the offending type', () => {
    deepStrictEqual(validateUpload(file({ type: 'image/gif' }), { types: ['image/png'] }, true), {
      ok: false,
      reason: { key: 'uploads.errors.typeNotAllowed', params: { type: 'image/gif' } },
    });
    strictEqual(validateUpload(file({ type: 'image/gif' }), { types: ['image/*'] }, true).ok, true);
    strictEqual(
      validateUpload(file({ type: 'application/pdf' }), { types: ['document'] }, false).ok,
      true,
    );
  });

  it('formats the size bounds as the server does', () => {
    deepStrictEqual(validateUpload(file({ size: 512 }), { minSize: '1kb' }, false), {
      ok: false,
      reason: { key: 'uploads.errors.fileTooSmall', params: { min: '1kb' } },
    });
    deepStrictEqual(validateUpload(file({ size: 3 * 1024 * 1024 }), { maxSize: '2mb' }, false), {
      ok: false,
      reason: { key: 'uploads.errors.fileTooLarge', params: { max: '2mb' } },
    });
  });

  it('checks the pixel bounds in width then height order', () => {
    deepStrictEqual(validateUpload(file(), { minWidth: 1000, minHeight: 1000 }, true), {
      ok: false,
      reason: { key: 'uploads.errors.minWidth', params: { min: 1000 } },
    });
    deepStrictEqual(validateUpload(file(), { maxWidth: 800, maxHeight: 400 }, true), {
      ok: false,
      reason: { key: 'uploads.errors.maxHeight', params: { max: 400 } },
    });
    deepStrictEqual(validateUpload(file(), { maxWidth: 400 }, true), {
      ok: false,
      reason: { key: 'uploads.errors.maxWidth', params: { max: 400 } },
    });
    deepStrictEqual(validateUpload(file({ height: 100 }), { minHeight: 200 }, true), {
      ok: false,
      reason: { key: 'uploads.errors.minHeight', params: { min: 200 } },
    });
  });

  it('passes the pixel bounds when the image has no recorded dimensions', () => {
    deepStrictEqual(
      validateUpload(
        file({ width: null, height: null }),
        { minWidth: 1000, minHeight: 1000 },
        true,
      ),
      { ok: true },
    );
  });

  it('reports the type before the size and the size before the pixels', () => {
    strictEqual(
      validateUpload(
        file({ type: 'image/gif', size: 1 }),
        { types: ['image/png'], minSize: 10 },
        true,
      ).ok,
      false,
    );
    deepStrictEqual(validateUpload(file({ size: 1 }), { minSize: 10, minWidth: 5000 }, true), {
      ok: false,
      reason: { key: 'uploads.errors.fileTooSmall', params: { min: '10b' } },
    });
  });
});

describe('constraintsOf', () => {
  it('keeps the known members in their declared shapes', () => {
    deepStrictEqual(
      constraintsOf({
        types: ['image'],
        minSize: 10,
        maxSize: '2mb',
        minWidth: 1,
        maxWidth: 2,
        minHeight: 3,
        maxHeight: 4,
        onDelete: 'setNull',
        max: 5,
      }),
      {
        types: ['image'],
        minSize: 10,
        maxSize: '2mb',
        minWidth: 1,
        maxWidth: 2,
        minHeight: 3,
        maxHeight: 4,
      },
    );
  });

  it('drops members of the wrong shape and reads nothing from absent options', () => {
    deepStrictEqual(constraintsOf({ types: 'image', minWidth: '10', maxSize: true }), {});
    deepStrictEqual(constraintsOf(undefined), {});
  });
});

describe('acceptOf', () => {
  it('passes exact types and wildcards and widens the four top-level categories', () => {
    strictEqual(acceptOf(['image', 'application/pdf']), 'image/*,application/pdf');
    strictEqual(acceptOf(['Video/*', 'audio']), 'video/*,audio/*');
    strictEqual(acceptOf(['font']), 'font/*');
  });

  it('accepts everything for a category it cannot name, a wildcard, or no types', () => {
    strictEqual(acceptOf(['document']), undefined);
    strictEqual(acceptOf(['image', '*']), undefined);
    strictEqual(acceptOf([]), undefined);
    strictEqual(acceptOf(undefined), undefined);
  });
});

describe('constraintWhere', () => {
  it('reads files alone without constraints', () => {
    deepStrictEqual(constraintWhere({}, false), { kind: 'file' });
  });

  it('narrows an image field to image types', () => {
    deepStrictEqual(constraintWhere({}, true), {
      and: [{ kind: 'file' }, { type: { startsWith: 'image/' } }],
    });
  });

  it('expresses exact types, wildcards, and the size bounds', () => {
    deepStrictEqual(
      constraintWhere(
        { types: ['image/png', 'video/*', 'audio'], minSize: '1kb', maxSize: 4096 },
        false,
      ),
      {
        and: [
          { kind: 'file' },
          {
            or: [
              { type: 'image/png' },
              { type: { startsWith: 'video/' } },
              { type: { startsWith: 'audio/' } },
            ],
          },
          { size: { atLeast: 1024 } },
          { size: { atMost: 4096 } },
        ],
      },
    );
  });

  it('drops the type filter for a category the grammar cannot name and for a wildcard', () => {
    deepStrictEqual(constraintWhere({ types: ['image/png', 'document'] }, false), { kind: 'file' });
    deepStrictEqual(constraintWhere({ types: ['*'] }, false), { kind: 'file' });
  });

  it('never filters the pixel bounds', () => {
    deepStrictEqual(constraintWhere({ minWidth: 100, maxHeight: 200 }, false), { kind: 'file' });
  });
});
