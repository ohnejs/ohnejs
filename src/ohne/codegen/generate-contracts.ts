import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
} from '../../utils/codegen/index.ts';
import { removeFile } from '../../utils/fs/index.ts';
import { isNull } from '../../utils/index.ts';
import { collectContracts } from '../contracts/collect-contracts.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { collectRoutes } from '../routes/collect-routes.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';
import { closerWins, emitRouteIDs } from './generate-api-types.ts';
import { linkedPaths } from './linked-paths.ts';

const WIRE = `type Raw = Response | string | Blob | ArrayBuffer | Uint8Array | ReadableStream;

type Skipped = ((...args: never) => unknown) | symbol | undefined;

type Wire<T> = 0 extends 1 & T
  ? any
  : T extends Raw
    ? Response
    : T extends void | null
      ? null
      : JSONOf<T>;

type JSONOf<T> = 0 extends 1 & T
  ? any
  : unknown extends T
    ? unknown
    : T extends { toJSON(): infer J }
      ? JSONOf<J>
      : T extends string | number | boolean | null
        ? T
        : T extends readonly unknown[]
          ? { -readonly [K in keyof T]: Item<T[K]> }
          : T extends Skipped | bigint
            ? never
            : T extends object
              ? Fields<T>
              : never;

type Item<V> = V extends Skipped ? null : JSONOf<V>;

type Fields<T> = {
  [K in keyof T as Kept<K, T[K]> extends true ? (Optional<T[K]> extends true ? never : K) : never]: JSONOf<T[K]>;
} & {
  [K in keyof T as Kept<K, T[K]> extends true ? (Optional<T[K]> extends true ? K : never) : never]?: JSONOf<
    Exclude<T[K], Skipped>
  >;
};

type Kept<K, V> = K extends symbol ? false : 0 extends 1 & V ? true : [V] extends [Skipped] ? false : true;

type Optional<V> = unknown extends V ? false : undefined extends V ? true : false;

type Answer<K extends keyof KnownRoutes> = KnownRoutes[K] extends (...args: never) => infer R
  ? Wire<Awaited<R>>
  : never;

type Drift = {
  [K in keyof Contracts & keyof KnownRoutes & string]: Contracts[K] extends { response?: infer R }
    ? [Answer<K>] extends [R]
      ? never
      : K
    : never;
}[keyof Contracts & keyof KnownRoutes & string];

type Unknown = Exclude<keyof Contracts & string, RouteID>;

type Stray = {
  [K in keyof Contracts]: Exclude<keyof Contracts[K] & string, 'response' | 'body' | 'query'>;
}[keyof Contracts];

export const drift: [Drift] extends [never]
  ? true
  : \`\\\`\${Drift}\\\` answers what its contract does not declare\` = true;

export const unknown: [Unknown] extends [never] ? true : \`\\\`\${Unknown}\\\` names no route\` = true;

export const stray: [Stray] extends [never]
  ? true
  : \`A contract declares \\\`\${Stray}\\\`, which is none of \\\`response\\\`, \\\`body\\\`, \\\`query\\\`\` = true;
`;

/**
 * Generates `node/contracts.ts`, which fails your typecheck when a route drifts from its contract.
 *
 * It merges every layer's `ohne.contract.ts`, a closer layer's entry winning per route id.
 * Each handler's answer, as the API serializes it, must be assignable to its declared `response`.
 * So a `Date` reads as `string`, and `undefined` or a function drops out of an object.
 * A string, bytes, or a stream read as the raw `Response`.
 * A declared id that names no route fails too, and so does a key other than `response`, `body`, or `query`.
 * A disabled route still counts as a route, since a further layer may declare it.
 * Bodies and queries are not checked.
 *
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns the file's absolute path, or `null` when no layer has a contract, removing a stale file.
 */
export async function generateContracts(from: string = process.cwd()): Promise<string | null> {
  const dir = await codegenBucket(from, 'node');
  if (isNull(dir)) return null;
  const gen = createCodeGenerator({ dir, banner: BANNER });
  const layers = stackedLayers();
  const entries = await collectContracts(layers);
  if (entries.length === 0) {
    await removeFile(gen.path('contracts.ts'));
    return null;
  }

  const linked = await linkedPaths(from);
  const routes = await collectRoutes(layers);
  const code = createCodeBuilder();
  code.line("import type { KnownRoutes } from 'ohnejs';");
  entries.forEach(({ file }, i) => {
    code.line(
      `import type { Routes as L${i} } from ${literalString(importSpecifier(dir, linked(file)))};`,
    );
  });
  code.line();
  code.line(`type Contracts = ${closerWins(entries.map((_, i) => `L${i}`))};`);
  code.line();
  emitRouteIDs(code, 'type RouteID', routes);
  code.line();
  code.line(WIRE.trimEnd());
  await gen.write('contracts.ts', code.toString());
  return gen.path('contracts.ts');
}
