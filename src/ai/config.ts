import type {
  CollectionName,
  Config,
  Env,
  KnownCollections,
  QueryFieldsOf,
  RouteRateLimit,
} from 'ohnejs';
import type { LayerStrategies, LiteralUnion, WithDefaultsStrategy } from 'ohnejs/utils';

import { ohneError, useConfig } from 'ohnejs';
import {
  createRateLimiter,
  didYouMean,
  errorMessage,
  hasKey,
  isInteger,
  isPositiveInteger,
  isString,
  isUndefined,
  parseBytes,
  parseDuration,
  withDefaults,
} from 'ohnejs/utils';
import { isEnvName } from 'ohnejs/utils/env';

import { DECIDE_PROMPT } from './prompts/decide.ts';
import { GUARD_PROMPT } from './prompts/guard.ts';
import { OPERATOR_PROMPT } from './prompts/operator.ts';
import { REMINDER_PROMPT } from './prompts/reminder.ts';
import { TRANSFORM_PROMPT } from './prompts/transform.ts';

declare module 'ohnejs' {
  interface Config {
    /**
     * Settings for the assistant layer: the models it runs on, what it may reach, and what it may see.
     * Every key is the app's own: a dependency layer never ships a model or widens reach.
     * Only `instructions` gathers across layers, closest first.
     */
    ai?: {
      /**
       * The `models` entry the assistant plans with.
       * Omitted, or without its key, the palette is search only.
       */
      model?: string;

      /**
       * The `models` entry that answers a flow's `decide` nodes, and the one entry that may be `jev`.
       * Omitted, `model` answers them with structured output.
       */
      decide?: string;

      /**
       * How a transform, a rewrite of text fields, runs.
       */
      transform?: {
        /**
         * The `models` entry every transform runs on, whatever the person picked.
         * Pin one to keep record values with one provider.
         * Omitted, a transform runs on the turn's model.
         */
        model?: string;
      };

      /**
       * The models the assistant may run on, by the name the other keys and the palette use.
       *
       * @default
       * {}
       */
      models?: Record<string, AIModel>;

      /**
       * The collections whose values may reach a model, each with `true` for every field or a field list.
       * A collection it leaves out stays blind: its receipts carry status, counts and ids, never values.
       *
       * @default
       * {}
       */
      data?: AIFields;

      /**
       * The app's own lines, read after the operator prompt.
       * A layer's lines follow the closer layer's.
       *
       * @default
       * []
       */
      instructions?: string[];

      /**
       * Every prompt the layer ships, each replaceable on its own; `''` drops the block.
       * The rules are enforced by the server either way, so a prompt changes wording, never reach.
       */
      prompts?: {
        /**
         * The rules the assistant keeps, first in every prompt.
         *
         * @default
         * AI_DEFAULTS.prompts.guard
         */
        guard?: string;

        /**
         * How the collections API works, after the guard.
         *
         * @default
         * AI_DEFAULTS.prompts.operator
         */
        operator?: string;

        /**
         * The system prompt of the call that rewrites a transform's fields.
         *
         * @default
         * AI_DEFAULTS.prompts.transform
         */
        transform?: string;

        /**
         * The last line of the turn context, closest to the person's words.
         *
         * @default
         * AI_DEFAULTS.prompts.reminder
         */
        reminder?: string;

        /**
         * The system prompt of a chat model answering a flow's `decide` node.
         *
         * @default
         * AI_DEFAULTS.prompts.decide
         */
        decide?: string;
      };

      /**
       * What the assistant never reaches.
       */
      deny?: {
        /**
         * Collections with no route, no `has` and no `populate` for the assistant, and refused in `data`.
         * A list you set replaces the default; spread `AI_DEFAULTS.deny.collections` to extend it.
         *
         * @default
         * ['Users', 'Sessions', 'AITurns']
         */
        collections?: LiteralUnion<Extract<keyof KnownCollections, string>>[];
      };

      /**
       * The routes the assistant may propose, each a route glob mapped to its tier.
       * Keys take the `disable.routes` syntax, and the first match in object order wins.
       * `false` forbids a route, and a route no key matches is never offered.
       * `/auth/**` and `/ai/**` never match.
       * A table you set replaces the default whole; spread `AI_DEFAULTS.routes` to extend it.
       *
       * @default
       * AI_DEFAULTS.routes
       */
      routes?: Record<string, AITier | false>;

      /**
       * Which writes run without asking, for a person who turned auto-accept on in their account.
       */
      autoAccept?: {
        /**
         * The most writes one turn applies without asking.
         *
         * @default
         * 0
         */
        max?: number;

        /**
         * The collections, with `true` for every field or a field list, whose writes may run without asking.
         * A write with any other key asks.
         *
         * @default
         * {}
         */
        fields?: AIFields;

        /**
         * The kinds of write that always ask, whatever `fields` allows.
         *
         * @default
         * ['destructive', 'set', 'locale', 'transform']
         */
        ask?: AIAskKind[];
      };

      /**
       * What one person and one turn may spend.
       */
      limits?: {
        /**
         * Turns one person may start, or `false` for no limit.
         *
         * @default
         * { limit: 30, window: '1h' }
         */
        turns?: RouteRateLimit | false;

        /**
         * Tokens one person may spend, or `false` for no limit.
         * A cache read costs a tenth of a token.
         *
         * @default
         * { limit: 1_000_000, window: '1d' }
         */
        tokens?: RouteRateLimit | false;

        /**
         * The most model steps one turn runs.
         *
         * @default
         * 12
         */
        steps?: number;

        /**
         * The most requests one step may propose.
         *
         * @default
         * 50
         */
        requests?: number;

        /**
         * The largest response body a receipt carries, in bytes or as a string like `'64kb'`.
         *
         * @default
         * '64kb'
         */
        resultSize?: number | string;

        /**
         * The longest one provider step may take, in milliseconds or as a string like `'2m'`.
         *
         * @default
         * '2m'
         */
        step?: number | string;

        /**
         * How long a turn may sit idle before it closes, in milliseconds or as a string like `'10m'`.
         *
         * @default
         * '10m'
         */
        turnTimeout?: number | string;

        /**
         * The most records one transform proposal rewrites.
         *
         * @default
         * 200
         */
        transform?: number;
      };

      /**
       * How long the turn log in `AITurns` keeps a closed turn.
       */
      audit?: {
        /**
         * The age a closed turn is deleted at, in milliseconds or as a string like `'90d'`.
         * `false` keeps every turn.
         *
         * @default
         * '90d'
         */
        retain?: number | string | false;
      };
    };
  }

  interface KnownCapabilities {
    /**
     * Asking the assistant in the dashboard palette.
     * The assistant then reaches only what the person reaches, and only what `ai.routes` and `ai.data` allow.
     */
    'ai.use': true;
  }
}

/**
 * The provider API a `models` entry talks to.
 *
 * - `anthropic`: the Anthropic Messages API.
 * - `openai`: the OpenAI Responses API.
 * - `openai-compatible`: a Chat Completions API, as most model servers speak it.
 * - `jev`: a classifier that answers a flow's `decide` nodes and nothing else.
 */
export type AIProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'jev';

/**
 * One model the assistant may run on.
 */
export interface AIModel {
  /**
   * The provider API the model is served by.
   */
  provider: AIProvider;

  /**
   * The model name as the provider's API takes it.
   */
  model: string;

  /**
   * The env var holding the API key, read at every call.
   * `false` sends no key, for a local server or one the `headers` authenticate with.
   */
  key: LiteralUnion<Extract<keyof Env, string>> | false;

  /**
   * The API's origin, with the path prefix the provider's own SDK expects.
   * Omitted, the provider's public API.
   */
  baseURL?: string;

  /**
   * Headers sent with every request, on top of the provider's own.
   */
  headers?: Record<string, string>;

  /**
   * Provider-native request fields, deep-merged under the fields the layer sets.
   */
  options?: Record<string, unknown>;

  /**
   * The model's context window in tokens, for a server that does not report it.
   */
  context?: number;

  /**
   * Whether record values may reach this model.
   * `false` keeps it blind whatever `ai.data` allows, and it never runs a transform.
   *
   * @default
   * true
   */
  data?: boolean;
}

/**
 * Collections mapped to `true` for every field, or to the fields named.
 */
export type AIFields = {
  [C in CollectionName]?: true | Extract<keyof QueryFieldsOf<C>, string>[];
};

/**
 * What a proposed request may do, and so how the person approves it.
 *
 * - `read`: runs at once.
 * - `write`: asks, unless auto-accept covers it.
 * - `destructive`: always asks, with a second click.
 */
export type AITier = 'read' | 'write' | 'destructive';

/**
 * A kind of write that `ai.autoAccept.ask` can make always ask.
 *
 * - `destructive`: a request whose tier is `destructive`.
 * - `set`: a write by `where`, to every matching record.
 * - `locale`: a write at a locale other than the default.
 * - `transform`: a rewrite of text fields.
 */
export type AIAskKind = 'destructive' | 'set' | 'locale' | 'transform';

/**
 * The resolved assistant settings: every `Config.ai` field, with the layer defaults filled in.
 */
export interface ResolvedAIConfig {
  /**
   * The `models` entry the assistant plans with, when one is set.
   */
  model?: string;

  /**
   * The `models` entry that answers a flow's `decide` nodes, when one is set.
   */
  decide?: string;

  /**
   * How a transform runs.
   */
  transform: {
    /**
     * The `models` entry every transform runs on, when one is pinned.
     */
    model?: string;
  };

  /**
   * The models the assistant may run on, by name.
   */
  models: Record<string, AIModel>;

  /**
   * The collections whose values may reach a model.
   */
  data: AIFields;

  /**
   * The app's own lines, closest layer first.
   */
  instructions: string[];

  /**
   * Every prompt the layer ships.
   */
  prompts: {
    /**
     * The rules the assistant keeps.
     */
    guard: string;

    /**
     * How the collections API works.
     */
    operator: string;

    /**
     * The system prompt of a transform's rewrite.
     */
    transform: string;

    /**
     * The last line of the turn context.
     */
    reminder: string;

    /**
     * The system prompt of a `decide` node on a chat model.
     */
    decide: string;
  };

  /**
   * What the assistant never reaches.
   */
  deny: {
    /**
     * The collections the assistant never reaches.
     */
    collections: string[];
  };

  /**
   * Route globs mapped to their tier, or `false` to forbid.
   */
  routes: Record<string, AITier | false>;

  /**
   * Which writes run without asking.
   */
  autoAccept: {
    /**
     * The most writes one turn applies without asking.
     */
    max: number;

    /**
     * The collections and fields whose writes may run without asking.
     */
    fields: AIFields;

    /**
     * The kinds of write that always ask.
     */
    ask: AIAskKind[];
  };

  /**
   * What one person and one turn may spend.
   */
  limits: {
    /**
     * Turns one person may start, or `false` for no limit.
     */
    turns: RouteRateLimit | false;

    /**
     * Tokens one person may spend, or `false` for no limit.
     */
    tokens: RouteRateLimit | false;

    /**
     * The most model steps one turn runs.
     */
    steps: number;

    /**
     * The most requests one step may propose.
     */
    requests: number;

    /**
     * The largest response body a receipt carries, in bytes or as a string like `'64kb'`.
     */
    resultSize: number | string;

    /**
     * The longest one provider step may take, in milliseconds or as a string like `'2m'`.
     */
    step: number | string;

    /**
     * How long a turn may sit idle, in milliseconds or as a string like `'10m'`.
     */
    turnTimeout: number | string;

    /**
     * The most records one transform proposal rewrites.
     */
    transform: number;
  };

  /**
   * How long the turn log keeps a closed turn.
   */
  audit: {
    /**
     * The age a closed turn is deleted at, or `false` to keep every turn.
     */
    retain: number | string | false;
  };
}

/**
 * The `Config.ai` defaults, which `useAIConfig` fills in wherever the app leaves a key unset.
 * Spread a list from here to extend it, since a list you set replaces the default.
 */
export const AI_DEFAULTS = {
  transform: {},
  models: {},
  data: {},
  instructions: [],
  prompts: {
    guard: GUARD_PROMPT,
    operator: OPERATOR_PROMPT,
    transform: TRANSFORM_PROMPT,
    reminder: REMINDER_PROMPT,
    decide: DECIDE_PROMPT,
  },
  deny: { collections: ['Users', 'Sessions', 'AITurns'] },
  routes: {
    'POST /collections/[collection]/query': 'read',
    'POST /collections/[collection]/verdicts': 'read',
    'GET /collections/[collection]/[uuid]': 'read',
    'GET /collections/[collection]/[uuid]/translations': 'read',
    'POST /collections/[collection]': 'write',
    'PATCH /collections/[collection]/[uuid]': 'write',
    'DELETE /collections/[collection]/[uuid]': 'destructive',
    'DELETE /collections/[collection]/[uuid]/translations': 'destructive',
    'POST /collections/[collection]/[uuid]/translations/copy': 'destructive',
  },
  autoAccept: { max: 0, fields: {}, ask: ['destructive', 'set', 'locale', 'transform'] },
  limits: {
    turns: { limit: 30, window: '1h' },
    tokens: { limit: 1_000_000, window: '1d' },
    steps: 12,
    requests: 50,
    resultSize: '64kb',
    step: '2m',
    turnTimeout: '10m',
    transform: 200,
  },
  audit: { retain: '90d' },
} satisfies ResolvedAIConfig;

/**
 * How `useAIConfig` merges the app's `Config.ai` over `AI_DEFAULTS`.
 * `routes` replaces, so a table you set never inherits a default route.
 */
export const AI_STRATEGIES: LayerStrategies = { routes: 'replace' };

/**
 * How each `Config.ai` key merges across layers, keyed by its name under `ai`.
 * Every key is the closest layer's own, so a dependency never ships a model or widens reach.
 * `instructions` gathers every layer's lines, closest first.
 * The layer's `ohne.layer.ts` declares them for the stack, prefixed with `ai.`.
 */
export const AI_LAYER_STRATEGIES = {
  model: 'own',
  decide: 'own',
  transform: 'own',
  models: 'own',
  data: 'own',
  instructions: 'concat',
  prompts: 'own',
  deny: 'own',
  routes: 'own',
  autoAccept: 'own',
  limits: 'own',
  audit: 'own',
} satisfies Record<keyof NonNullable<Config['ai']>, WithDefaultsStrategy>;

const TIERS: readonly unknown[] = ['read', 'write', 'destructive', false];

/**
 * Returns the resolved assistant settings, the app's `Config.ai` merged over `AI_DEFAULTS`.
 * Valid wherever config is.
 */
export function useAIConfig(): ResolvedAIConfig {
  return withDefaults(useConfig().ai ?? {}, AI_DEFAULTS, { strategies: AI_STRATEGIES });
}

/**
 * Checks every assistant setting the layer reads, throwing an error block that names the first bad one.
 * A boot file runs it, so the API server and every command stop before any turn.
 * Collections and fields are checked once the schema is known, by the `server:ready` hook.
 */
export function validateAIConfig(): void {
  const config = useAIConfig();
  validateModels(config);
  validateRoutes(config.routes);
  validatePrompts(config.prompts);
  validateDeny(config);
  validateLimits(config);
}

/**
 * Refuses a model key that is no env var name, and a model reference `models` lacks.
 * A `jev` model answers only `decide`, so it may not plan or transform.
 * A pinned transform model must see values, since a transform sends them.
 */
function validateModels({ models, model, decide, transform }: ResolvedAIConfig): void {
  for (const [name, entry] of Object.entries(models)) {
    if (entry.key !== false && !isEnvName(entry.key)) {
      throw invalidValue(
        `models.${name}.key`,
        entry.key,
        'It is the name of the env var holding the API key, such as `ANTHROPIC_API_KEY`, or `false`.',
      );
    }
  }
  const references = { model, decide, 'transform.model': transform.model };
  for (const [key, name] of Object.entries(references)) {
    if (isUndefined(name)) continue;
    if (!hasKey(models, name)) {
      const near = didYouMean(name, Object.keys(models));
      throw ohneError({
        title: `\`ai.${key}\` names unknown model \`${name}\``,
        body: [
          `No entry \`${name}\` is declared under \`ai.models\`.`,
          ...(isUndefined(near) ? [] : [`Did you mean \`${near}\`?`]),
        ],
      });
    }
    if (key !== 'decide' && models[name].provider === 'jev') {
      throw ohneError({
        title: `\`ai.${key}\` names the \`jev\` model \`${name}\``,
        body: [
          'A `jev` model answers flow decisions only, through `ai.decide`.',
          '',
          `Name an \`anthropic\`, \`openai\` or \`openai-compatible\` model in \`ai.${key}\`.`,
        ],
      });
    }
    if (key === 'transform.model' && models[name].data === false) {
      throw ohneError({
        title: `\`ai.transform.model\` names the blind model \`${name}\``,
        body: [
          'A transform sends record values, and the model sets `data: false`.',
          '',
          'Pin a model that may see values, or remove `ai.transform.model`.',
        ],
      });
    }
  }
}

/**
 * Refuses a tier outside the set.
 */
function validateRoutes(routes: ResolvedAIConfig['routes']): void {
  for (const [glob, tier] of Object.entries(routes)) {
    if (!TIERS.includes(tier)) {
      throw ohneError({
        title: `Invalid \`ai.routes\` tier \`${tier}\` for \`${glob}\``,
        body: [
          'A tier is `read`, `write` or `destructive`, or `false` to forbid the route.',
          'Fix it under `ai.routes`.',
        ],
      });
    }
  }
}

/**
 * Refuses a prompt that is not a string.
 */
function validatePrompts(prompts: ResolvedAIConfig['prompts']): void {
  for (const [key, prompt] of Object.entries(prompts)) {
    if (!isString(prompt)) {
      throw ohneError({
        title: `Invalid \`ai.prompts.${key}\``,
        body: [
          "A prompt is a string, and `''` drops the block.",
          `Fix it under \`ai.prompts.${key}\`.`,
        ],
      });
    }
  }
}

/**
 * Refuses `data` or `autoAccept.fields` naming a collection `deny.collections` lists.
 */
function validateDeny({ deny, data, autoAccept }: ResolvedAIConfig): void {
  const opened = { data, 'autoAccept.fields': autoAccept.fields };
  for (const [key, fields] of Object.entries(opened)) {
    const name = Object.keys(fields).find((collection) => deny.collections.includes(collection));
    if (isUndefined(name)) continue;
    throw ohneError({
      title: `\`ai.${key}\` names the denied collection \`${name}\``,
      body: [
        '`ai.deny.collections` lists it, so the assistant never reaches it.',
        '',
        `Remove \`${name}\` from \`ai.${key}\`, or from \`ai.deny.collections\`.`,
      ],
    });
  }
}

/**
 * Refuses a rate, count, size or duration that does not parse.
 */
function validateLimits({ limits, autoAccept, audit }: ResolvedAIConfig): void {
  for (const [key, rate] of Object.entries({ turns: limits.turns, tokens: limits.tokens })) {
    if (rate === false) continue;
    try {
      createRateLimiter(rate);
    } catch (error) {
      throw ohneError({
        title: `Invalid \`ai.limits.${key}\``,
        body: [errorMessage(error), '', 'Set a positive whole `limit` and `window`, or `false`.'],
      });
    }
  }
  const counts = {
    'limits.steps': limits.steps,
    'limits.requests': limits.requests,
    'limits.transform': limits.transform,
  };
  for (const [key, value] of Object.entries(counts)) {
    if (!isPositiveInteger(value)) {
      throw invalidValue(key, value, 'It is a whole number above zero.');
    }
  }
  if (!isInteger(autoAccept.max) || autoAccept.max < 0) {
    throw invalidValue('autoAccept.max', autoAccept.max, 'It is a whole number, `0` or above.');
  }
  if (!parses(() => parseBytes(limits.resultSize) > 0)) {
    throw invalidValue(
      'limits.resultSize',
      limits.resultSize,
      'It is a byte size above zero, such as `64kb`, or a number of bytes.',
    );
  }
  const durations = {
    'limits.step': limits.step,
    'limits.turnTimeout': limits.turnTimeout,
    ...(audit.retain === false ? {} : { 'audit.retain': audit.retain }),
  };
  for (const [key, value] of Object.entries(durations)) {
    if (!parses(() => parseDuration(value) > 0)) {
      throw invalidValue(
        key,
        value,
        'It is a duration above zero, such as `2m`, or a number of milliseconds.',
      );
    }
  }
}

/**
 * Whether `parse` runs without throwing and returns anything but `false`.
 */
function parses(parse: () => unknown): boolean {
  try {
    return parse() !== false;
  } catch {
    return false;
  }
}

/**
 * The error block for an `ai.<key>` setting whose `value` does not parse, with the `form` it takes.
 */
function invalidValue(key: string, value: unknown, form: string): Error {
  return ohneError({
    title: `Invalid \`ai.${key}\` value \`${value}\``,
    body: [form, `Fix it under \`ai.${key}\`.`],
  });
}
