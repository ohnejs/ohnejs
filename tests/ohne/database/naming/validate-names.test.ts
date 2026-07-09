import { doesNotThrow, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  validateCollectionName,
  validateFieldName,
  validateUniqueNames,
} from '../../../../src/ohne/database/naming/validate-names.ts';

describe('validateCollectionName', () => {
  it('accepts a PascalCase name, embedded acronym included', () => {
    doesNotThrow(() => validateCollectionName('Posts'));
    doesNotThrow(() => validateCollectionName('APIKeys'));
  });

  it('rejects an empty or blank name', () => {
    throws(() => validateCollectionName(''), /empty/);
    throws(() => validateCollectionName('   '), /empty/);
  });

  it('rejects a non-PascalCase name', () => {
    throws(() => validateCollectionName('posts'), /PascalCase/);
    throws(() => validateCollectionName('Blog_Posts'), /PascalCase/);
    throws(() => validateCollectionName('Blog Posts'), /PascalCase/);
  });

  it('rejects reserved names case-insensitively', () => {
    throws(() => validateCollectionName('Ohne'), /reserved/);
    throws(() => validateCollectionName('Block'), /reserved/);
    throws(() => validateCollectionName('BLOCK'), /reserved/);
  });
});

describe('validateFieldName', () => {
  it('accepts a camelCase name, trailing acronym included', () => {
    doesNotThrow(() => validateFieldName('title', 'Posts'));
    doesNotThrow(() => validateFieldName('featuredImage', 'Posts'));
    doesNotThrow(() => validateFieldName('parseHTML', 'Posts'));
  });

  it('rejects an empty or blank name', () => {
    throws(() => validateFieldName('', 'Posts'), /empty/);
    throws(() => validateFieldName('   ', 'Posts'), /empty/);
  });

  it('rejects a non-camelCase name', () => {
    throws(() => validateFieldName('Title', 'Posts'), /camelCase/);
    throws(() => validateFieldName('created_at', 'Posts'), /camelCase/);
    throws(() => validateFieldName('_hidden', 'Posts'), /camelCase/);
    throws(() => validateFieldName('kebab-case', 'Posts'), /camelCase/);
  });

  it('rejects `uuid`, which collides with the primary key', () => {
    throws(() => validateFieldName('uuid', 'Posts'), /reserved/);
  });
});

describe('validateUniqueNames', () => {
  it('accepts distinct names', () => {
    doesNotThrow(() => validateUniqueNames(['Posts', 'Authors'], 'collection'));
  });

  it('rejects a case-insensitive collision', () => {
    throws(() => validateUniqueNames(['Posts', 'posts'], 'collection'), /collide/);
    throws(() => validateUniqueNames(['title', 'Title'], 'field', 'Posts'), /collide/);
  });
});
