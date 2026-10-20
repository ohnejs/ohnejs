import { defineField, option } from 'ohnejs';
import {
  displayName,
  duplicates,
  isEmpty,
  isString,
  isUndefined,
  matchesCodeOrName,
} from 'ohnejs/utils';
import { literalUnion } from 'ohnejs/utils/codegen';

import { activeLanguage } from '../../ohne/http/translate.ts';

/**
 * What one ISO code field type is built from.
 */
interface IsoCodeSpec<TCode extends string> {
  codes: readonly TCode[];
  isCode: (value: unknown) => value is TCode;
  kind: 'region' | 'currency';
  typeName: 'CountryCode' | 'CurrencyCode';
  invalid: 'validation.invalidCountry' | 'validation.invalidCurrency';
  name: string;
  example: TCode;
}

/**
 * A field type storing one ISO code, like a country or a currency, upper-cased on write.
 * `only` narrows the codes a field admits; a code outside it fails with `validation.invalidChoice`.
 * Search matches the exact code in any case, or a word start of its name in the request's language.
 */
export function isoCodeField<TCode extends string>(spec: IsoCodeSpec<TCode>) {
  return defineField({
    columnType: 'text',
    options: {
      /**
       * The codes this field admits, in upper case.
       * Omitted, every code is admitted.
       */
      only: option<readonly TCode[]>(),
    },
    emitType: (ctx) =>
      isUndefined(ctx.options.only)
        ? ctx.importType('ohnejs/utils', spec.typeName)
        : literalUnion(ctx.options.only),
    emitJSONType: (ctx) => literalUnion(ctx.options.only ?? spec.codes),
    // Only ASCII letters upper-case, so `ß` never turns into `SS`, a code it never was.
    sanitizers: [(value) => (/^[a-z]+$/i.test(value) ? value.toUpperCase() : value)],
    validators: [
      (value) => (spec.isCode(value) ? undefined : spec.invalid),
      (value, ctx) =>
        isUndefined(ctx.options.only) || ctx.options.only.includes(value as TCode)
          ? undefined
          : 'validation.invalidChoice',
    ],
    validateOptions: ({ options }) => codeListProblem(options, spec),
    search: {
      default: false,
      match: ({ token, options }) => {
        const language = activeLanguage();
        const hits = (options.only ?? spec.codes).filter((code) =>
          matchesCodeOrName(code, displayName(code, spec.kind, language), token),
        );
        return isEmpty(hits) ? null : { in: hits };
      },
    },
  });
}

/**
 * What makes a field's `only` list or literal `default` unusable, as error body rows, or `undefined`.
 * A lower-case `default` passes the boot check through the sanitizer, but the dashboard seeds it as written.
 */
function codeListProblem<TCode extends string>(
  options: { only?: readonly string[]; default?: unknown },
  spec: IsoCodeSpec<TCode>,
): string[] | undefined {
  const { only } = options;
  const fix = `Write each code in upper case, like \`${spec.example}\`.`;
  if (!isUndefined(only)) {
    if (isEmpty(only))
      return ['`only` is empty, so no value can be chosen.', 'List at least one code.'];
    const repeated = duplicates(only);
    if (!isEmpty(repeated)) {
      return [
        '`only` repeats a code.',
        'Drop the duplicates:',
        '',
        ...repeated.map((code) => `- \`${code}\``),
      ];
    }
    const unknown = only.filter((code) => !spec.isCode(code));
    if (!isEmpty(unknown)) {
      return [
        `\`only\` lists values that are no ${spec.name}:`,
        '',
        ...unknown.map((code) => `- \`${code}\``),
        '',
        fix,
      ];
    }
  }
  if (isString(options.default) && !spec.isCode(options.default)) {
    return [`\`default\` is \`${options.default}\`, which is no ${spec.name}.`, fix];
  }
  return undefined;
}
