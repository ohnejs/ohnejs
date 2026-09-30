import type { CollectionQueryMeta, EventStream, QueryScope } from 'ohnejs';
import type { User } from 'ohnejs/auth';
import type { SearchParamValue } from 'ohnejs/utils';

import {
  admittedUUIDs,
  parseWireQuery,
  queryMetadata,
  resolveGuards,
  scopedMetadata,
  sendEvents,
  useEvent,
  useRequest,
} from 'ohnejs';
import {
  chunk,
  hasKey,
  isArray,
  isEmpty,
  isNull,
  isPlainObject,
  isString,
  isUndefined,
} from 'ohnejs/utils';

import type { Completion, PromptBlock, Provider } from '../providers/provider.ts';
import type { Proposal, Transform } from './proposals.ts';

import { listRecords, readReach, writeReach } from '../../base/collections-api/gate.ts';
import { queryLocales } from '../../ohne/query/locale.ts';
import { useAIConfig } from '../config.ts';
import { estimatedUsage, isProviderError } from '../providers/provider.ts';
import { chargeTokens, stepSignal, tokenWait } from './limits.ts';

/**
 * The values of one record's rewritable fields, `null` for a field the record leaves empty.
 */
export type TransformValues = Record<string, string | null>;

/**
 * One record the model rewrote, as the `records` event carries it.
 */
export interface TransformedRecord {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The values the model read, per field.
   */
  source: TransformValues;

  /**
   * The values the model answered, per field.
   */
  proposed: TransformValues;

  /**
   * Set when the record lacks the locale written, so `source` holds the default locale's values.
   * Its update creates the translation, so it sends every field, changed or not.
   */
  fallback?: true;
}

/**
 * Why a record a transform reached was not rewritten.
 *
 * - `notYours`: the person may not update it.
 * - `incomplete`: it lacks the locale to write, and the transform leaves out a required translatable field.
 * - `failed`: the model did not answer its chunk.
 * - `malformed`: the model answered its chunk with something other than the records asked for.
 */
export type SkipReason = 'notYours' | 'incomplete' | 'failed' | 'malformed';

/**
 * One record the transform reached and skipped, as the `skipped` event carries it.
 */
export interface SkippedRecord {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * Why it was skipped.
   */
  reason: SkipReason;
}

/**
 * One record read for a transform, before the model sees it.
 */
export interface TransformSource {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The values to rewrite, per field.
   */
  values: TransformValues;

  /**
   * Set when the record lacks the locale written and `values` were read at the default locale.
   */
  fallback?: true;

  /**
   * Why the record is skipped instead of sent, when it is.
   */
  skip?: SkipReason;
}

/**
 * What a transform read: the records it reaches, and how many the proposal matched in all.
 */
export interface TransformRead {
  /**
   * The records in the read's order, at most `ai.limits.transform` of them.
   */
  records: TransformSource[];

  /**
   * How many records the proposal's filter matched, the unreached ones included.
   */
  matched: number;
}

/**
 * What one transform runs on.
 */
export interface TransformRun {
  /**
   * The person the turn belongs to.
   */
  user: User;

  /**
   * The transform proposal, as the batch keeps it.
   */
  proposal: Proposal;

  /**
   * The collection the proposal writes.
   */
  collection: string;

  /**
   * The records read for it.
   */
  read: TransformRead;

  /**
   * The provider of the model that rewrites.
   */
  provider: Provider;

  /**
   * Frees the permit; the stream calls it once it ends.
   */
  release: () => void;
}

/**
 * How many records one model call rewrites.
 */
const CHUNK = 20;

/**
 * How often the stream pings while the provider is silent.
 */
const HEARTBEAT = '15s';

/**
 * Reads the records a transform proposal reaches, as the person reads them under their read `scope`.
 * Each carries the listed fields at the locale the proposal writes.
 * `matched` counts every record the filter hit, the unreached ones included.
 * At most `ai.limits.transform` records are read, in the read's order.
 * A record the person may not update is skipped as `notYours`, before any value reaches a model.
 * A translatable record lacking the locale to write is rewritten from the default locale.
 * One that also leaves out a required translatable field is skipped as `incomplete`: its update would fail.
 * Valid only within a request, after the collection's read gate passed.
 */
export async function readTransformRecords(
  proposal: Proposal,
  collection: string,
  scope: QueryScope,
): Promise<TransformRead> {
  const { fields } = proposal.transform as Transform;
  const meta = queryMetadata(collection);
  const scoped = scopedMetadata(meta, scope);
  const locale = isString(proposal.query?.locale) ? proposal.query.locale : undefined;
  const written = locale ?? queryLocales().defaultLocale;
  const held = meta.translatable === true && hasKey(scoped.fields, '_translations');
  const select = ['UUID', ...fields, ...(held ? ['_translations'] : [])];
  const where = proposal.where ?? { UUID: proposal.params?.uuid };
  const cap = useAIConfig().limits.transform;
  const perPage = Math.min(cap, resolveGuards().maxPerPage);
  const rows: Record<string, unknown>[] = [];
  let matched = 0;
  for (let page = 1; rows.length < cap; page++) {
    const params = { where, select, page, perPage, ...(isUndefined(locale) ? {} : { locale }) };
    const result = await readPage(
      collection,
      params as Record<string, SearchParamValue>,
      scoped,
      scope,
    );
    matched = result.total;
    rows.push(...result.records.slice(0, cap - rows.length));
    if (page >= result.lastPage) break;
  }
  const uuids = rows.map((row) => row.UUID as string);
  const mine = await updatable(collection, uuids, locale ?? null);
  const required = requiredTranslatable(collection).filter((name) => !fields.includes(name));
  const lacking = new Set(
    rows
      .filter((row) => held && isArray(row._translations) && !row._translations.includes(written))
      .map((row) => row.UUID as string),
  );
  const sources = new Map<string, TransformValues>();
  if (written !== queryLocales().defaultLocale) {
    for (const part of chunk([...lacking], Math.min(perPage, resolveGuards().maxInLength))) {
      const params = { where: { UUID: { in: part } }, select, page: 1, perPage: part.length };
      const { records } = await readPage(collection, params, scoped, scope);
      for (const row of records) sources.set(row.UUID as string, valuesOf(row, fields));
    }
  }
  const records = rows.map((row): TransformSource => {
    const UUID = row.UUID as string;
    const source = sources.get(UUID);
    const values = source ?? valuesOf(row, fields);
    if (!mine.has(UUID)) return { UUID, values, skip: 'notYours' };
    if (lacking.has(UUID) && !isEmpty(required)) return { UUID, values, skip: 'incomplete' };
    return isUndefined(source) ? { UUID, values } : { UUID, values, fallback: true };
  });
  return { records, matched };
}

/**
 * Opens the event stream of one transform and runs it behind.
 * The stream ends when the transform does, whichever way; the permit frees with it.
 * The handler returns the body as is.
 */
export function streamTransform(run: TransformRun): ReadableStream<Uint8Array> {
  const stream = sendEvents({ heartbeat: HEARTBEAT, onClose: run.release });
  useEvent().waitUntil(runTransform(run, stream).finally(() => stream.close()));
  return stream.body;
}

/**
 * Runs one transform: sends the readable records to the model in chunks and streams what comes back.
 * `start` names how many records the proposal matched and how many the transform reaches.
 * Each chunk answers a `records` event, or a `skipped` one when the model failed it or answered badly.
 * A chunk's tokens are charged as it answers, its estimated input when it ends before.
 * A chunk the budget no longer admits ends the run as `limit`.
 * A chunk past `ai.limits.step` ends it as `timeout`; the client leaving ends it silently.
 * `done` counts the records rewritten and skipped.
 */
export async function runTransform(
  { user, proposal, collection, read, provider }: TransformRun,
  stream: EventStream,
): Promise<void> {
  const { signal } = useRequest();
  const transform = proposal.transform as Transform;
  const send = (event: string, data: unknown): void => {
    stream.send(JSON.stringify(data), { event });
  };
  send('start', { matched: read.matched, reached: read.records.length });
  const skipped = read.records.filter((record) => !isUndefined(record.skip));
  const sendable = read.records.filter((record) => isUndefined(record.skip));
  let transformed = 0;
  let left = skipped.length;
  if (!isEmpty(skipped)) send('skipped', { skipped: skipped.map(skipOf) });
  const system = transformPrompt(transform.instruction, collection, proposal);
  const schema = answerSchema(transform.fields);
  let deadline: AbortSignal | undefined;
  try {
    for (const part of chunk(sendable, CHUNK)) {
      if ((await tokenWait(user)) > 0) {
        send('error', { code: 'limit' });
        return;
      }
      const input = JSON.stringify({ records: part.map(toInput) });
      const request = { system, input, schema };
      deadline = stepSignal();
      let completion: Completion | undefined;
      try {
        completion = await provider.complete(request, deadline);
      } catch (error) {
        await chargeTokens(user, estimatedUsage(request));
        if (!isProviderError(error) || deadline.aborted) throw error;
      }
      if (!isUndefined(completion)) await chargeTokens(user, completion.usage);
      const outcome = isUndefined(completion)
        ? 'failed'
        : (readAnswer(completion.value, part, transform.fields) ?? 'malformed');
      if (isString(outcome)) {
        left += part.length;
        send('skipped', { skipped: part.map(({ UUID }) => ({ UUID, reason: outcome })) });
        continue;
      }
      transformed += part.length;
      send('records', {
        records: part.map(
          ({ UUID, values, fallback }): TransformedRecord => ({
            UUID,
            source: values,
            proposed: outcome.get(UUID) as TransformValues,
            ...(isUndefined(fallback) ? {} : { fallback }),
          }),
        ),
      });
    }
    send('done', { transformed, skipped: left });
  } catch (error) {
    if (signal.aborted) return;
    if (deadline?.aborted) {
      send('error', { code: 'timeout' });
      return;
    }
    send('error', { code: 'internal' });
    throw error;
  }
}

/**
 * One page of `collection` as the person's list read answers it, the wire `params` parsed under `scoped`.
 */
async function readPage(
  collection: string,
  params: Record<string, SearchParamValue>,
  scoped: CollectionQueryMeta,
  scope: QueryScope,
): Promise<{ records: Record<string, unknown>[]; total: number; lastPage: number }> {
  const parsed = await parseWireQuery(params, scoped, resolveGuards(), readReach);
  return (await listRecords(collection, parsed, scope)) as {
    records: Record<string, unknown>[];
    total: number;
    lastPage: number;
  };
}

/**
 * The `UUID`s among `uuids` the person's update reaches at `locale`; none when they cannot update at all.
 */
async function updatable(
  collection: string,
  uuids: readonly string[],
  locale: string | null,
): Promise<ReadonlySet<string>> {
  const reach = await writeReach(collection, 'update');
  if (reach === false) return new Set();
  if (isUndefined(reach.where)) return new Set(uuids);
  return admittedUUIDs(collection, queryMetadata(collection), reach.where, uuids, locale);
}

/**
 * The translatable fields a translation of `collection` must hold: required, and written by the person.
 */
function requiredTranslatable(collection: string): string[] {
  const { fields } = queryMetadata(collection);
  return Object.keys(fields).filter((name) => {
    const field = fields[name];
    return (
      field.companion === true &&
      !field.nullable &&
      field.writable !== false &&
      isUndefined(field.options?.default)
    );
  });
}

/**
 * The listed fields of a row, each a string or `null`; a value of any other shape reads as `null`.
 */
function valuesOf(row: Record<string, unknown>, fields: readonly string[]): TransformValues {
  const values: TransformValues = {};
  for (const name of fields) {
    const value = row[name];
    values[name] = isString(value) ? value : null;
  }
  return values;
}

/**
 * The record as the model reads it: its `UUID` and each value, an empty one as `''`.
 */
function toInput({ UUID, values }: TransformSource): Record<string, string> {
  const input: Record<string, string> = { UUID };
  for (const [name, value] of Object.entries(values)) input[name] = value ?? '';
  return input;
}

/**
 * A skipped record as its event carries it.
 */
function skipOf({ UUID, skip }: TransformSource): SkippedRecord {
  return { UUID, reason: skip as SkipReason };
}

/**
 * The system prompt of a transform: `ai.prompts.transform`, then the instruction and the locale to write.
 * The instruction block ends the cached prefix, so every chunk of one transform reuses it.
 */
function transformPrompt(
  instruction: string,
  collection: string,
  proposal: Proposal,
): PromptBlock[] {
  const { prompts } = useAIConfig();
  const lines = ['# Instruction', instruction.trim()];
  if (queryMetadata(collection).translatable === true) {
    const locale = isString(proposal.query?.locale)
      ? proposal.query.locale
      : queryLocales().defaultLocale;
    lines.push(`Locale: \`${locale}\`. Every value you answer is in this locale.`);
  }
  return [
    ...(prompts.transform === '' ? [] : [{ text: prompts.transform }]),
    { text: lines.join('\n'), cache: true },
  ];
}

/**
 * The JSON Schema of a chunk's answer: the records, each its `UUID` and every field as a string.
 */
function answerSchema(fields: readonly string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = { UUID: { type: 'string' } };
  for (const name of fields) properties[name] = { type: 'string' };
  return {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties,
          required: ['UUID', ...fields],
          additionalProperties: false,
        },
      },
    },
    required: ['records'],
    additionalProperties: false,
  };
}

/**
 * The answered values by `UUID`, or `null` when the answer drifts from the chunk it was asked for.
 * It drifts when a record is missing, repeated or unasked, carries other keys, or a value is not a string.
 * A value the model emptied reads as `null` where the source was empty too, so an untouched field stays so.
 */
function readAnswer(
  value: unknown,
  part: readonly TransformSource[],
  fields: readonly string[],
): Map<string, TransformValues> | null {
  if (!isPlainObject(value) || !isArray(value.records) || value.records.length !== part.length) {
    return null;
  }
  const asked = new Map(part.map((record) => [record.UUID, record]));
  const answered = new Map<string, TransformValues>();
  for (const entry of value.records) {
    if (!isPlainObject(entry) || !isString(entry.UUID)) return null;
    const source = asked.get(entry.UUID);
    if (isUndefined(source) || answered.has(entry.UUID)) return null;
    if (Object.keys(entry).length !== fields.length + 1) return null;
    const values: TransformValues = {};
    for (const name of fields) {
      const proposed = entry[name];
      if (!isString(proposed)) return null;
      values[name] = proposed === '' && isNull(source.values[name]) ? null : proposed;
    }
    answered.set(entry.UUID, values);
  }
  return answered;
}
