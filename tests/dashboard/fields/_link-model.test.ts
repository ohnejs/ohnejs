import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RecordURLCollection } from '../../../src/dashboard/fields/_link-model.ts';
import type { Link } from '../../../src/utils/rich-text/link.ts';

import {
  choiceKeyword,
  dashboardRecordTarget,
  linkChoiceValue,
  linkOf,
  linkTargetOf,
  readLinkKeyword,
} from '../../../src/dashboard/fields/_link-model.ts';

const ORIGIN = 'https://admin.example.com';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

const collections: RecordURLCollection[] = [
  { name: 'Pages', segment: 'pages' },
  { name: 'Uploads', segment: 'uploads', recordPath: '/media?details=[uuid]' },
];

describe('linkChoiceValue', () => {
  it('round-trips a record and an address through linkTargetOf', () => {
    const record = { collection: 'Pages', record: UUID };
    const url = { url: 'https://x.y/a?b=c#d' };
    deepStrictEqual(linkTargetOf(linkChoiceValue(record)), record);
    deepStrictEqual(linkTargetOf(linkChoiceValue(url)), url);
  });

  it('encodes only the target of a link, never its options', () => {
    const link: Link = { collection: 'Pages', record: UUID, hash: 'top', newTab: true };
    strictEqual(linkChoiceValue(link), `record:Pages:${UUID}`);
  });

  it('keeps an address that looks like a record value distinct from one', () => {
    deepStrictEqual(linkTargetOf(linkChoiceValue({ url: `record:Pages:${UUID}` })), {
      url: `record:Pages:${UUID}`,
    });
  });
});

describe('linkTargetOf', () => {
  it('reads anything it did not encode as nothing', () => {
    strictEqual(linkTargetOf(null), undefined);
    strictEqual(linkTargetOf(42), undefined);
    strictEqual(linkTargetOf('https://x.y'), undefined);
    strictEqual(linkTargetOf('record:Pages'), undefined);
  });
});

describe('choiceKeyword', () => {
  it('opens the search on an address, and empty on a record or nothing', () => {
    strictEqual(choiceKeyword(linkChoiceValue({ url: 'https://x.y' })), 'https://x.y');
    strictEqual(choiceKeyword(linkChoiceValue({ collection: 'Pages', record: UUID })), '');
    strictEqual(choiceKeyword(null), '');
  });
});

describe('dashboardRecordTarget', () => {
  it('matches a record editor URL, with or without extra query parameters', () => {
    const target = { collection: 'Pages', record: UUID };
    deepStrictEqual(
      dashboardRecordTarget(`${ORIGIN}/collections/pages/${UUID}`, collections, ORIGIN),
      target,
    );
    deepStrictEqual(
      dashboardRecordTarget(`${ORIGIN}/collections/pages/${UUID}?locale=de#x`, collections, ORIGIN),
      target,
    );
  });

  it('matches a collection whose records open at a declared path', () => {
    deepStrictEqual(
      dashboardRecordTarget(`${ORIGIN}/media?details=${UUID}&locale=de`, collections, ORIGIN),
      { collection: 'Uploads', record: UUID },
    );
  });

  it('refuses another origin, a relative path, an unlisted collection and a non-UUID', () => {
    strictEqual(
      dashboardRecordTarget(`https://evil.example/collections/pages/${UUID}`, collections, ORIGIN),
      undefined,
    );
    strictEqual(
      dashboardRecordTarget(`/collections/pages/${UUID}`, collections, ORIGIN),
      undefined,
    );
    strictEqual(
      dashboardRecordTarget(`${ORIGIN}/collections/users/${UUID}`, collections, ORIGIN),
      undefined,
    );
    strictEqual(
      dashboardRecordTarget(`${ORIGIN}/collections/pages/42`, collections, ORIGIN),
      undefined,
    );
    strictEqual(
      dashboardRecordTarget(`${ORIGIN}/collections/pages/${UUID}/edit`, collections, ORIGIN),
      undefined,
    );
  });
});

describe('readLinkKeyword', () => {
  it('offers a bare host as an `https:` address only when it passes `isSafeHref`', () => {
    deepStrictEqual(readLinkKeyword('example.com', collections, ORIGIN), {
      target: { url: 'https://example.com' },
      safe: true,
    });
    deepStrictEqual(readLinkKeyword(' example.com/a?b=1 ', collections, ORIGIN), {
      target: { url: 'https://example.com/a?b=1' },
      safe: true,
    });
    deepStrictEqual(readLinkKeyword('https://bank.example@evil.example', collections, ORIGIN), {
      target: { url: 'https://bank.example@evil.example' },
      safe: false,
    });
  });

  it('reads a refused scheme as an unsafe address instead of searching for it', () => {
    deepStrictEqual(readLinkKeyword('javascript:alert(1)', collections, ORIGIN), {
      target: { url: 'javascript:alert(1)' },
      safe: false,
    });
  });

  it('reads a dashboard record URL as its record', () => {
    deepStrictEqual(readLinkKeyword(`${ORIGIN}/collections/pages/${UUID}`, collections, ORIGIN), {
      target: { collection: 'Pages', record: UUID },
      safe: true,
    });
  });

  it('leaves plain words to the record search', () => {
    strictEqual(readLinkKeyword('thrall', collections, ORIGIN), undefined);
    strictEqual(readLinkKeyword('thrall jaina', collections, ORIGIN), undefined);
    strictEqual(readLinkKeyword('', collections, ORIGIN), undefined);
  });
});

describe('linkOf', () => {
  it('builds the canonical record link, stripping the anchor and dropping a false new tab', () => {
    deepStrictEqual(
      linkOf({ collection: 'Pages', record: UUID }, { hash: '#top', newTab: false }),
      {
        collection: 'Pages',
        record: UUID,
        hash: 'top',
      },
    );
    deepStrictEqual(linkOf({ collection: 'Pages', record: UUID }, { hash: '', newTab: true }), {
      collection: 'Pages',
      record: UUID,
      newTab: true,
    });
  });

  it('gives an address no anchor', () => {
    deepStrictEqual(linkOf({ url: 'https://x.y' }, { hash: 'top', newTab: true }), {
      url: 'https://x.y',
      newTab: true,
    });
  });
});
