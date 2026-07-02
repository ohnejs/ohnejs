import type { MessageMeta } from '../messages/messages.ts';

import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
  literalString,
  literalUnion,
  propertyKey,
} from '../../utils/codegen/index.ts';
import {
  errorMessage,
  groupBy,
  isNull,
  joinPath,
  type MessageParamType,
  messageParamTypes,
  relativePath,
  uniqueArray,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useConfig } from '../layers/use-config.ts';
import { collectMessages } from '../messages/collect-messages.ts';
import { resolveOhneLayers } from '../project/resolve-ohne-layers.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';

/**
 * Generates the message catalog and its types from every layer's messages directory.
 *
 * Emits one file per codegen bucket, so the server and dashboard share a single source of truth.
 * `shared/messages.ts` types every key as `GeneratedMessages` and every language as `GeneratedLanguages`.
 * `node/messages.ts` augments `ohne` and registers each catalog.
 * `browser/messages.ts` augments `ohne/dashboard`.
 * Both augmentations only `extends` the shared types, so the key body is written once, never per target.
 *
 * Messages are read from each layer's `Config.dirs.messages` directory and merged per key.
 * Keys matched by `Config.disable.messages` are dropped before the catalog and its types are emitted.
 * A key's parameters must match across every language that defines it, or generation throws.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the app's own `dirs.codegen` (default `.ohne`), resolved against that root.
 *
 * Each file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateMessages(from: string = process.cwd()): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];

  const messages = await collectMessages(await resolveOhneLayers(from), {
    disable: useConfig().disable.messages,
  });
  const keyTypes = unifyKeyTypes(messages);
  const languages = uniqueArray(messages.map((message) => message.language)).sort();

  return Promise.all([
    writeShared(joinPath(dir, 'shared'), keyTypes, languages),
    writeNode(joinPath(dir, 'node'), messages),
    writeBrowser(joinPath(dir, 'browser')),
  ]);
}

/**
 * Writes `shared/messages.ts`: the pure `GeneratedMessages` and `GeneratedLanguages` types.
 * It holds no runtime and references no module, so both the node and browser programs include it.
 */
async function writeShared(
  dir: string,
  keyTypes: Map<string, string>,
  languages: string[],
): Promise<string> {
  const code = createCodeBuilder();
  emitInterface(
    code,
    'export interface GeneratedMessages',
    [...keyTypes].map(([key, type]) => `${propertyKey(key)}: ${type};`),
  );
  code.line();
  emitInterface(
    code,
    'export interface GeneratedLanguages',
    languages.map((language) => `${propertyKey(language)}: true;`),
  );
  return write(dir, code);
}

/**
 * Writes `node/messages.ts`: augments `ohne`'s `KnownMessages` and `KnownLanguages`, registers each catalog.
 */
async function writeNode(dir: string, messages: readonly MessageMeta[]): Promise<string> {
  const code = createCodeBuilder();
  if (messages.length > 0) {
    code.line("import { useMessages } from 'ohne';");
    code.line();
  }
  code.line("import type { GeneratedLanguages, GeneratedMessages } from '../shared/messages.ts';");
  code.line();
  code.line("declare module 'ohne' {");
  code.indent(() => {
    code.line('interface KnownMessages extends GeneratedMessages {}');
    code.line('interface KnownLanguages extends GeneratedLanguages {}');
  });
  code.line('}');

  if (messages.length > 0) {
    code.line();
    code.line('const messages = useMessages();');
    for (const [language, entries = []] of Object.entries(groupBy(messages, (m) => m.language))) {
      code.line();
      code.line(`messages.register(${literalString(language)}, {`);
      code.indent(() => {
        for (const entry of entries) {
          code.line(`${propertyKey(entry.key)}: ${literalString(entry.template)},`);
        }
      });
      code.line('});');
    }
  }
  return write(dir, code);
}

/**
 * Writes `browser/messages.ts`: augments `ohne/dashboard` for `useT` and `useDashboardLanguage`.
 * Its shape is constant; it only wires the shared types onto the browser's interfaces.
 */
async function writeBrowser(dir: string): Promise<string> {
  const code = createCodeBuilder();
  code.line("import type { GeneratedLanguages, GeneratedMessages } from '../shared/messages.ts';");
  code.line();
  code.line("declare module 'ohne/dashboard' {");
  code.indent(() => {
    code.line('interface KnownMessages extends GeneratedMessages {}');
    code.line('interface DashboardLanguages extends GeneratedLanguages {}');
  });
  code.line('}');
  return write(dir, code);
}

async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('messages.ts', code.toString());
  return gen.path('messages.ts');
}

/**
 * Emits `head { ... }`, collapsing to `head {}` when there are no members.
 */
function emitInterface(code: CodeBuilder, head: string, members: string[]): void {
  if (members.length === 0) {
    code.line(`${head} {}`);
    return;
  }
  code.line(`${head} {`);
  code.indent(() => code.lines(members));
  code.line('}');
}

/**
 * Maps each key to its rendered TypeScript parameter type, sorted by key for deterministic output.
 * Throws when a key's parameters disagree between two languages.
 */
function unifyKeyTypes(messages: readonly MessageMeta[]): Map<string, string> {
  const seen = new Map<string, { language: string; file: string; type: string }>();
  for (const message of messages) {
    const type = renderParamObject(paramsOf(message));
    const first = seen.get(message.key);
    if (!first) {
      seen.set(message.key, { language: message.language, file: message.file, type });
      continue;
    }
    if (first.type !== type) {
      throw ohneError({
        title: `Message \`${message.key}\` has different parameters across languages`,
        body: [
          `Every language must declare the same parameters for \`${message.key}\`.`,
          `\`${first.language}\` expects \`${first.type}\`; \`${message.language}\` expects \`${type}\`.`,
          '',
          `- \`${relativePath(process.cwd(), first.file)}\``,
          `- \`${relativePath(process.cwd(), message.file)}\``,
        ],
      });
    }
  }

  return new Map([...seen.keys()].sort().map((key) => [key, seen.get(key)!.type]));
}

function paramsOf(message: MessageMeta): Record<string, MessageParamType> {
  try {
    return messageParamTypes(message.template);
  } catch (error) {
    throw ohneError({
      title: `Invalid message \`${message.key}\` for \`${message.language}\``,
      body: errorMessage(error),
      path: message.file,
    });
  }
}

function renderParamObject(params: Record<string, MessageParamType>): string {
  const names = Object.keys(params).sort();
  if (names.length === 0) return '{}';
  const fields = names.map((name) => `${propertyKey(name)}: ${renderParamType(params[name]!)}`);
  return `{ ${fields.join('; ')} }`;
}

function renderParamType(type: MessageParamType): string {
  switch (type.kind) {
    case 'value':
      return 'string | number';
    case 'number':
      return 'number';
    case 'date':
      return 'Date | number';
    case 'choice':
      return type.options.length === 0 ? 'string' : literalUnion([...type.options].sort());
  }
}
