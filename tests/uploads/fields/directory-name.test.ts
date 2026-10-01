import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../src/ohne/fields/define-field.ts';

import { searchHook } from '../../../src/ohne/fields/field-search.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import directoryName from '../../../src/uploads/fields/directory-name.ts';
import { searchUploads, userWith } from '../_fixture.ts';

const admin = await userWith('admin@x.test', ['uploads-admin']);
const report = await queryUntyped('Uploads').createOrThrow({
  kind: 'file',
  directory: 'Berichte/Übersicht 2024',
  name: 'q3.pdf',
});

const directoryNameSearch = searchHook(directoryName)!;

const search = (token: string) =>
  directoryNameSearch({ name: 'directory', options: {}, token } as unknown as FieldSearchContext);

describe('directoryName search', () => {
  it('matches the canonical form the directory is stored in', () => {
    deepStrictEqual(search('Übersicht'), { contains: 'ubersicht' });
    deepStrictEqual(search('Q3 Final'), { contains: 'q3-final' });
    deepStrictEqual(search('Release 1.2'), { contains: 'release-1-2' });
    deepStrictEqual(search('Photos/2024 Summer'), { contains: 'photos/2024-summer' });
  });

  it('gives `null` for a token with nothing to slug', () => {
    for (const token of ['§§', '---', '/']) strictEqual(search(token), null);
  });
});

describe('directoryName field', () => {
  it('canonicalizes a stored directory', () => {
    const [canonical] = directoryName.sanitizers!;
    strictEqual(canonical!('Photos//2024 Summer/', {} as never), 'photos/2024-summer');
  });
});

describe('Uploads search by directory', () => {
  it('finds a file by its directory as typed', async () => {
    strictEqual(report.directory, 'berichte/ubersicht-2024');
    deepStrictEqual(await searchUploads(admin, 'Übersicht 2024'), [report.UUID]);
  });
});
