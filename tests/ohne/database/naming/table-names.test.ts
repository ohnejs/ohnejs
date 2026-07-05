import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  blockTableName,
  collectionTableName,
  companionTableName,
  derivedTableName,
} from '../../../../src/ohne/database/naming/table-names.ts';
import { truncateWithHash } from '../../../../src/utils/crypto/index.ts';

describe('collectionTableName', () => {
  it('keeps the collection name verbatim', () => {
    strictEqual(collectionTableName('Posts'), 'Posts');
    strictEqual(collectionTableName('APIKeys'), 'APIKeys');
  });

  it('caps an over-long name with the full-name hash', () => {
    const name = 'A'.repeat(80);
    strictEqual(collectionTableName(name), truncateWithHash(name));
    strictEqual(collectionTableName(name).length, 63);
  });
});

describe('derivedTableName', () => {
  it('joins the owner and field with a single underscore', () => {
    strictEqual(derivedTableName('Posts', 'authors'), 'Posts_authors');
  });

  it('composes nested derivations', () => {
    strictEqual(derivedTableName('Posts', 'sections', 'items'), 'Posts_sections_items');
  });

  it('truncates once, hashing the full logical name', () => {
    const owner = 'A'.repeat(80);
    strictEqual(derivedTableName(owner, 'items'), truncateWithHash(`${owner}_items`));
  });

  it('rejects an already-truncated part', () => {
    const truncated = collectionTableName('A'.repeat(80));
    throws(() => derivedTableName(truncated, 'items'), /already-truncated/);
  });
});

describe('companionTableName', () => {
  it('marks the companion with a double underscore', () => {
    strictEqual(companionTableName('Posts'), 'Posts__translations');
  });
});

describe('blockTableName', () => {
  it('prefixes the block name, casing kept verbatim', () => {
    strictEqual(blockTableName('Hero'), 'block_Hero');
    strictEqual(blockTableName('PricingCard'), 'block_PricingCard');
  });
});
