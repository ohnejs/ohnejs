import type { TypeImports } from '../../utils/codegen/type-imports.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { EmitJSONTypeContext, EmitTypeContext } from './context.ts';
import type { FieldType } from './define-field.ts';
import type { AnyOptionDef } from './option.ts';

import { isArray, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { resolveFieldOptions } from './field.ts';

/**
 * Arguments to `fieldValueType`.
 */
export interface FieldValueTypeArgs<TOptions extends Record<string, AnyOptionDef>> {
  /**
   * The registered field type whose value type is being emitted.
   */
  fieldType: FieldType<TOptions>;

  /**
   * The field's key in its collection, exposed to `emitType` as `ctx.name`.
   */
  name: string;

  /**
   * The instance options passed to `field(...)` - the type's own options plus the common ones.
   */
  options: Record<string, unknown>;

  /**
   * The directory of the field type's own file, against which `importType` resolves relative paths.
   */
  fieldDir: string;

  /**
   * The import collector for the file being generated; `importType` records into it.
   */
  imports: TypeImports;
}

/**
 * The TypeScript value type a column-bearing field falls back to when it declares no `emitType`.
 */
const FALLBACK: Record<LogicalType, string> = {
  text: 'string',
  integer: 'number',
  real: 'number',
  boolean: 'boolean',
  json: 'unknown',
};

/**
 * One field's value type split into its non-null base and whether the field admits `null`.
 * The generated read shape wants `base | null`; the query metadata wants the base and the flag apart.
 */
export interface FieldBaseType {
  /**
   * The value type without any `| null`, exactly as `emitType` (or the fallback) produced it.
   */
  base: string;

  /**
   * Whether the field's value shape admits `null` (instance `nullable` or type `forceNullable`).
   */
  nullable: boolean;
}

/**
 * Emits one field's non-null base type and its nullability, the shared core of the value-type emitters.
 *
 * Runs the field type's `emitType` when it declares one, otherwise falls back from `columnType`.
 * The type's own options are resolved with their defaults before reaching `emitType` as `ctx.options`.
 * An `emitType` returning `string[]` is joined with `\n`, so a multiline type comes back as one string.
 *
 * A column-less field derives its type from its storage hint.
 * A junction holds the linked rows' `UUID` values in order, so its base is `string[]`, never null.
 * A child hint is assembled from its subfields at codegen, where the registered types are at hand.
 * It therefore throws here, as does a column-less type without a hint.
 *
 * An `importType` of a program entry (`'ohnejs'`, `'ohnejs/dashboard'`) is rejected.
 * The emitted shapes land in the shared bucket, which both type programs load, so neither entry may leak in.
 *
 * @example
 * ```ts
 * fieldBaseType({
 *   fieldType: text,
 *   name: 'title',
 *   options: { nullable: true },
 *   fieldDir,
 *   imports,
 * })
 * // -> { base: 'string', nullable: true }
 * ```
 */
export function fieldBaseType<TOptions extends Record<string, AnyOptionDef>>(
  args: FieldValueTypeArgs<TOptions>,
): FieldBaseType {
  const { fieldType, name, options, fieldDir, imports } = args;
  const resolved = resolveFieldOptions(fieldType, options);

  if (fieldType.columnType === false) {
    const hint = fieldType.schema?.({ name, options: resolved });
    if (hint?.kind === 'junction') return { base: 'string[]', nullable: false };
    throw ohneError({
      title: 'Cannot emit a type for a column-less field',
      body: [
        'A column-less field type (`columnType: false`) owns no column, so it has no value type to emit.',
        "A junction emits `string[]`; a composite's shape is assembled from its subfields at codegen.",
      ],
    });
  }

  const ctx: EmitTypeContext<TOptions> = {
    name,
    options: resolved,
    importType: (path, exportName) => {
      if (path === 'ohnejs' || path === 'ohnejs/dashboard') {
        throw ohneError({
          title: 'Browser-unsafe type import in `emitType`',
          body: [
            'The emitted shapes land in the shared bucket, which both type programs load.',
            `Importing \`${path}\` there pulls one program's entry into the other.`,
            '',
            'Import from a pure types module, or reference generated types with `importGenerated`.',
          ],
        });
      }
      return imports.reference({ fromDir: fieldDir, path, exportName });
    },
    importGenerated: (path, exportName) =>
      imports.reference({
        fromDir: imports.dir,
        path: path.startsWith('.') ? path : `./${path}`,
        exportName,
      }),
  };

  const emitted = fieldType.emitType ? fieldType.emitType(ctx) : FALLBACK[fieldType.columnType];
  const base = isArray(emitted) ? emitted.join('\n') : emitted;
  return { base, nullable: resolved.nullable };
}

/**
 * Emits one field's TypeScript value type as a source string, `| null` folded in when nullable.
 *
 * The read-shape emitter: a nullable field comes back as `base | null`, everything else as its base.
 * This is the value type only; the caller assembles the surrounding property and indents each line.
 *
 * @example
 * ```ts
 * fieldValueType({ fieldType: text, name: 'title', options: {}, fieldDir, imports })
 * // -> 'string'
 *
 * fieldValueType({
 *   fieldType: text,
 *   name: 'title',
 *   options: { nullable: true },
 *   fieldDir,
 *   imports,
 * })
 * // -> 'string | null'
 * ```
 */
export function fieldValueType<TOptions extends Record<string, AnyOptionDef>>(
  args: FieldValueTypeArgs<TOptions>,
): string {
  const { base, nullable } = fieldBaseType(args);
  return nullable ? `${base} | null` : base;
}

/**
 * Maps a type an `ohnejs` module exports to the module a website imports it from.
 * Returns the website's module specifier, or `undefined` when the website has no such type.
 */
export type TypeMirror = (path: string, exportName: string) => string | undefined;

/**
 * Arguments to `fieldJSONType`.
 */
export interface FieldJSONTypeArgs<TOptions extends Record<string, AnyOptionDef>> {
  /**
   * The registered field type whose JSON type is being emitted.
   */
  fieldType: FieldType<TOptions>;

  /**
   * The field's key in its collection, exposed to the hooks as `ctx.name`.
   */
  name: string;

  /**
   * The name the field type is registered under, named in an error.
   */
  type: string;

  /**
   * The file that defines the field type, the path of an error; absent for a built-in.
   */
  file?: string;

  /**
   * The instance options passed to `field(...)` - the type's own options plus the common ones.
   */
  options: Record<string, unknown>;

  /**
   * The import collector of the website types file; a resolvable `importType` records into it.
   */
  imports: TypeImports;

  /**
   * Maps an `ohnejs` type to the module the website reads it from.
   */
  mirror: TypeMirror;
}

/**
 * One field's JSON type: its non-null base, whether it admits `null`, and why it fell back to `unknown`.
 */
export interface FieldJSONType extends FieldBaseType {
  /**
   * Why the base is `unknown` when the field type could not describe its JSON form, as one sentence.
   */
  reason?: string;
}

/**
 * Emits one field's value type as a website receives it: the JSON form of what a read returns.
 *
 * The first tier that applies wins:
 * - `emitJSONType` runs, its `importType` resolved through `mirror`.
 * - A `deserialize` makes the type `unknown`, since only the field type knows that value's JSON form.
 * - Without `emitType`, the type falls back from `columnType`, as the database types do.
 * - `emitType` is reused when every type it imports has a `mirror`; anything else makes it `unknown`.
 *
 * A `deserialize` or an unmirrored `emitType` import adds a `reason`.
 * An aborted `emitType` records no import.
 * `nullable` folds a translatable column in, since such a field reads `null` where a locale has none.
 *
 * In `emitJSONType`, an import that `mirror` does not map passes through as a package name.
 * A relative path or an `ohnejs` module throws: the website has neither.
 * The error names `type` and points at `file`.
 *
 * @example
 * ```ts
 * fieldJSONType({
 *   fieldType: richText,
 *   name: 'body',
 *   type: 'richText',
 *   options: { links: ['Pages'] },
 *   imports,
 *   mirror,
 * })
 * // -> { base: "RichText<'Pages'>", nullable: false }
 *
 * fieldJSONType({
 *   fieldType: instant,
 *   name: 'at',
 *   type: 'instant',
 *   options: { nullable: true },
 *   imports,
 *   mirror,
 * })
 * // -> { base: 'string', nullable: true }
 * ```
 */
export function fieldJSONType<TOptions extends Record<string, AnyOptionDef>>(
  args: FieldJSONTypeArgs<TOptions>,
): FieldJSONType {
  const { fieldType, name, type, file, options, imports, mirror } = args;
  if (fieldType.columnType === false) {
    return fieldBaseType({ fieldType, name, options, fieldDir: imports.dir, imports });
  }
  const resolved = resolveFieldOptions(fieldType, options);
  const nullable = resolved.nullable || options.translatable === true;
  const json = (emitted: string | string[]): FieldJSONType => ({
    base: isArray(emitted) ? emitted.join('\n') : emitted,
    nullable,
  });
  const unknown = (reason: string): FieldJSONType => ({ base: 'unknown', nullable, reason });

  if (fieldType.emitJSONType) {
    const ctx: EmitJSONTypeContext<TOptions> = {
      name,
      options: resolved,
      importType: (path, exportName) => {
        const mirrored = mirror(path, exportName);
        if (isUndefined(mirrored) && (isLocalPath(path) || isOhnePath(path))) {
          throw ohneError({
            title: `Unresolvable type import in field type \`${type}\``,
            body: [
              `Its \`emitJSONType\` imports \`${exportName}\` from \`${path}\`, which a website cannot import.`,
              '',
              'Inline the type, or import it from a package the website installs.',
            ],
            path: file,
          });
        }
        return imports.reference({ fromDir: imports.dir, path: mirrored ?? path, exportName });
      },
    };
    return json(fieldType.emitJSONType(ctx));
  }
  if (fieldType.deserialize) {
    return unknown(
      '`deserialize` changes the value a read returns, and its JSON form is not declared.',
    );
  }
  if (!fieldType.emitType) return json(FALLBACK[fieldType.columnType]);

  let blocked: string | undefined;
  const probe: EmitTypeContext<TOptions> = {
    name,
    options: resolved,
    importType: (path, exportName) => {
      if (isUndefined(mirror(path, exportName))) blocked ??= `\`emitType\` imports \`${path}\``;
      return exportName;
    },
    importGenerated: (path) => {
      blocked ??= `\`emitType\` imports the generated \`${path}\``;
      return 'unknown';
    },
  };
  fieldType.emitType(probe);
  if (!isUndefined(blocked)) return unknown(`${blocked}, which a website cannot resolve.`);
  return json(
    fieldType.emitType({
      ...probe,
      importType: (path, exportName) =>
        imports.reference({
          fromDir: imports.dir,
          path: mirror(path, exportName) ?? path,
          exportName,
        }),
    }),
  );
}

/**
 * Whether an import path names a file rather than a package: relative or absolute.
 */
function isLocalPath(path: string): boolean {
  return path.startsWith('.') || path.startsWith('/');
}

/**
 * Whether an import path names `ohnejs` or one of its subpath modules.
 */
function isOhnePath(path: string): boolean {
  return path === 'ohnejs' || path.startsWith('ohnejs/');
}
