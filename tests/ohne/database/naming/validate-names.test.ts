import { doesNotThrow, match, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import {
  validateCollectionName,
  validateFieldName,
  validateUniqueNames,
} from '../../../../src/ohne/database/naming/validate-names.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';

function namesConditionGrammar(error: unknown): boolean {
  ok(isOhneError(error));
  match(error.message, /reserved/);
  match(
    Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? ''),
    /condition grammar/,
  );
  return true;
}

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

  it('rejects the condition grammar keys `and`, `or`, and `not`', () => {
    throws(() => validateFieldName('and', 'Posts'), namesConditionGrammar);
    throws(() => validateFieldName('or', 'Posts'), namesConditionGrammar);
    throws(() => validateFieldName('not', 'Posts'), namesConditionGrammar);
  });

  it('rejects the condition grammar keys case-insensitively', () => {
    throws(() => validateFieldName('aND', 'Posts'), namesConditionGrammar);
    throws(() => validateFieldName('oR', 'Posts'), namesConditionGrammar);
    throws(() => validateFieldName('nOt', 'Posts'), namesConditionGrammar);
  });

  it('rejects the condition grammar keys in composite subfields', () => {
    throws(() => validateFieldName('and', 'Posts.sections'), namesConditionGrammar);
    throws(() => validateFieldName('or', 'Posts.sections'), namesConditionGrammar);
    throws(() => validateFieldName('not', 'Posts.sections'), namesConditionGrammar);
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
