import type { ResolvedFieldOptions } from './field.ts';
import type { AnyOptionDef, ResolvedOptions } from './option.ts';

/**
 * The context every field-type callback receives about a single field instance.
 *
 * Carries the field's name and its resolved options - the type's own options plus the common ones.
 * `emitType` extends it with `importType` (`EmitTypeContext`).
 */
export interface FieldContext<TOptions extends Record<string, AnyOptionDef>> {
  /**
   * The key the field is registered under in its collection: the `title` in `{ title: field('text') }`.
   */
  name: string;

  /**
   * The field instance's fully resolved options: the type's declared options plus the common ones.
   *
   * Every option carrying a default is present, so you read it directly - no `?? default` at the call.
   * Only an option declared without a default may be absent.
   */
  options: ResolvedOptions<TOptions> & ResolvedFieldOptions;
}

/**
 * The context passed to a field type's `emitType`.
 *
 * Adds `importType` so the emitted type expression can reference a type from another module.
 */
export interface EmitTypeContext<
  TOptions extends Record<string, AnyOptionDef>,
> extends FieldContext<TOptions> {
  /**
   * Brings a named type from another module into the generated file, to use in what `emitType` returns.
   *
   * Use it when the emitted type is not a TypeScript built-in but comes from another file or a package.
   * It adds the `import type` for you and returns the local name to drop into your type string.
   * Always use that returned name; it is aliased when another module already exported the same name.
   *
   * Write `path` as you would import it from your own field file.
   * A relative path (`'./geo.ts'`) resolves against that file; a package name (`'zod'`) is used as is.
   *
   * @example
   * ```ts
   * // emit `LatLng[]`, importing `LatLng` from a sibling module
   * emitType: (ctx) => {
   *   const LatLng = ctx.importType('./geo.ts', 'LatLng')
   *   return `${LatLng}[]`
   * }
   * ```
   */
  importType(path: string, exportName: string): string;
}
