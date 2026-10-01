import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../src/ohne/fields/define-field.ts';

import { searchHook } from '../../../src/ohne/fields/field-search.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import fileName from '../../../src/uploads/fields/file-name.ts';
import { canonicalFolderName } from '../../../src/uploads/uploads/path.ts';
import { searchUploads, userWith } from '../_fixture.ts';

const HASH = 'f3a9c1d27be04e5a';

const admin = await userWith('admin@x.test', ['uploads-admin']);
const report = await queryUntyped('Uploads').createOrThrow({
  kind: 'file',
  directory: 'Reports 2024',
  name: 'Übersicht Q3 final.pdf',
  type: 'application/pdf',
  size: 10,
  hash: HASH,
});

const release = await queryUntyped('Uploads').createOrThrow({
  kind: 'folder',
  directory: '',
  name: canonicalFolderName('Release 1.2'),
});

const fileNameSearch = searchHook(fileName)!;

const search = (token: string) =>
  fileNameSearch({ name: 'name', options: {}, token } as unknown as FieldSearchContext);

describe('fileName search', () => {
  it('matches the canonical form the name is stored in', () => {
    deepStrictEqual(search('Übersicht'), { contains: 'ubersicht' });
    deepStrictEqual(search('Q3 Final'), { contains: 'q3-final' });
    deepStrictEqual(search('Release 1.2'), {
      or: [{ contains: 'release-1.2' }, { contains: 'release-1-2' }],
    });
  });

  it('never matches the `file` stem a token with nothing before its extension would get', () => {
    deepStrictEqual(search('§.pdf'), { contains: 'pdf' });
  });

  it('gives `null` for a token with nothing to slug', () => {
    for (const token of ['§§', '---', '…']) strictEqual(search(token), null);
  });
});

describe('fileName field', () => {
  it('canonicalizes a stored name and keeps the text validators', () => {
    const [canonical] = fileName.sanitizers!;
    strictEqual(canonical!('Sunset At Sea.JPG', {} as never), 'sunset-at-sea.jpg');
    const [nonEmpty] = fileName.validators!;
    strictEqual(
      nonEmpty!('', { options: { allowEmpty: false } } as never),
      'validation.emptyValue',
    );
  });
});

describe('Uploads search', () => {
  it('finds a file by its name as typed', async () => {
    strictEqual(report.name, 'ubersicht-q3-final.pdf');
    deepStrictEqual(await searchUploads(admin, 'Übersicht'), [report.UUID]);
    deepStrictEqual(await searchUploads(admin, '"Q3 Final"'), [report.UUID]);
  });

  it('finds a folder whose dotted name was stored with hyphens', async () => {
    deepStrictEqual(await searchUploads(admin, '"Release 1.2"'), [release.UUID]);
  });

  it('leaves the hash and the author out', async () => {
    deepStrictEqual(await searchUploads(admin, HASH.slice(2, 10)), []);
    const { fields } = queryMetadata('Uploads');
    strictEqual(fields.hash!.search, undefined);
    strictEqual(fields.author!.search, undefined);
  });
});
