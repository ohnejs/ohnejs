import type { FlowDefinition, FlowTier } from './define-flow.ts';

import {
  isArray,
  isEmpty,
  isMessage,
  isPlainObject,
  isRealNumber,
  isString,
  isUndefined,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

const MESSAGE = 'be a message key, a plain string, or a `{ key, params }` object';

const QUESTION = 'be one of `{ choice }`, `{ score }` or `{ yesNo }`';

const TIERS: ReadonlySet<unknown> = new Set<FlowTier>(['read', 'write', 'destructive']);

/**
 * Validates a flow definition.
 * `description` is required and `title` optional.
 * Each is a message key, a plain string, or a `{ key, params }` object.
 * `start` and every edge name a node, and every node is reachable from `start`.
 * A decide node has questions and a `next`; an act node's `next` is a node or a list of nodes.
 * A branch routes `on` a question of its own node, with `cases` only for that question's options.
 */
export function validateFlowDefinition(definition: FlowDefinition): void {
  const { title, description, start, nodes }: Partial<Record<keyof FlowDefinition, unknown>> =
    definition;
  if (!isMessage(description)) throw invalid('description', MESSAGE);
  if (!isUndefined(title) && !isMessage(title)) throw invalid('title', MESSAGE);
  if (!isPlainObject(nodes) || isEmpty(nodes))
    throw invalid('nodes', 'be an object of nodes by id');
  const ids = new Set(Object.keys(nodes));
  if (!isString(start) || !ids.has(start)) throw invalid('start', 'name a node');

  const edges = new Map<string, string[]>();
  for (const [id, node] of Object.entries(nodes)) edges.set(id, validateNode(id, node, ids));

  const reached = new Set([start]);
  for (const id of reached) edges.get(id)?.forEach((target) => reached.add(target));
  const unreachable = [...ids].filter((id) => !reached.has(id));
  if (unreachable.length > 0) {
    throw ohneError({
      title: 'Invalid flow definition',
      body: [
        'Every node must be reachable from `start`, and these are not:',
        '',
        ...unreachable.map((id) => `- \`${id}\``),
      ],
    });
  }
}

/**
 * Validates one node and returns the ids its edges lead to.
 */
function validateNode(id: string, node: unknown, ids: ReadonlySet<string>): string[] {
  const path = `nodes.${id}`;
  if (!isPlainObject(node) || isUndefined(node.decide) === isUndefined(node.act)) {
    throw invalid(path, 'be an object with either `decide` or `act`');
  }
  const { decide, act, next } = node;
  if (isUndefined(decide)) {
    validateAct(`${path}.act`, act);
    return isUndefined(next) ? [] : targetsOf(`${path}.next`, next, ids);
  }
  const options = validateDecide(`${path}.decide`, decide);
  if (isUndefined(next)) throw invalid(`${path}.next`, 'be set on a decide node');
  return validateNext(`${path}.next`, next, options, ids);
}

/**
 * Validates a decide node's questions and returns each question's options by name.
 */
function validateDecide(path: string, decide: unknown): Map<string, string[]> {
  if (!isPlainObject(decide)) throw invalid(path, 'be an object with `questions`');
  validateModel(`${path}.model`, decide.model);
  const { questions } = decide;
  if (!isPlainObject(questions) || isEmpty(questions)) {
    throw invalid(`${path}.questions`, 'be an object of questions by name');
  }
  return new Map(
    Object.entries(questions).map(([name, question]) => [
      name,
      optionsOf(`${path}.questions.${name}`, question),
    ]),
  );
}

/**
 * Validates one question and returns the options a branch may key its `cases` on.
 */
function optionsOf(path: string, question: unknown): string[] {
  if (!isPlainObject(question) || Object.keys(question).length !== 1) throw invalid(path, QUESTION);
  const { choice, score, yesNo } = question;
  if (!isUndefined(choice)) {
    if (!isPlainObject(choice) || isEmpty(choice) || !Object.values(choice).every(isText)) {
      throw invalid(`${path}.choice`, 'be an object of option descriptions by option');
    }
    return Object.keys(choice);
  }
  if (!isUndefined(score)) {
    const levels = isArray(score) && score.every(isText) ? score : [];
    if (levels.length < 2 || levels.length > 10 || new Set(levels).size !== levels.length) {
      throw invalid(`${path}.score`, 'be between 2 and 10 distinct level names, lowest first');
    }
    return levels;
  }
  if (!isText(yesNo)) throw invalid(path, QUESTION);
  return ['yes', 'no'];
}

/**
 * Validates an act node's skill, prompt, model and tiers.
 */
function validateAct(path: string, act: unknown): void {
  if (!isPlainObject(act)) throw invalid(path, 'be an object');
  const { skill, prompt, model, tiers } = act;
  if (!isUndefined(skill) && !isText(skill)) throw invalid(`${path}.skill`, 'be a skill name');
  if (!isUndefined(prompt) && !isText(prompt)) {
    throw invalid(`${path}.prompt`, 'be a non-empty string');
  }
  validateModel(`${path}.model`, model);
  if (!isUndefined(tiers) && (!isArray(tiers) || !tiers.every((tier) => TIERS.has(tier)))) {
    throw invalid(`${path}.tiers`, 'be a list of `read`, `write` and `destructive`');
  }
}

/**
 * Validates a decide node's `next` and returns the ids it leads to.
 */
function validateNext(
  path: string,
  next: unknown,
  options: ReadonlyMap<string, string[]>,
  ids: ReadonlySet<string>,
): string[] {
  if (!isPlainObject(next)) return targetsOf(path, next, ids);

  const { on, cases, below } = next;
  const known = isString(on) ? options.get(on) : undefined;
  if (isUndefined(known)) throw invalid(`${path}.on`, 'name a question of its node');
  if (!isPlainObject(cases)) throw invalid(`${path}.cases`, 'be an object of node ids by option');
  const targets = Object.entries(cases).flatMap(([option, to]) => {
    if (!known.includes(option)) {
      throw invalid(`${path}.cases.${option}`, `name an option of \`${on}\``);
    }
    return targetsOf(`${path}.cases.${option}`, to, ids);
  });
  if (isUndefined(below)) return targets;

  if (!isPlainObject(below) || !isRealNumber(below.confidence)) {
    throw invalid(`${path}.below`, 'be an object with a `confidence` and a `to`');
  }
  if (below.confidence < 0 || below.confidence > 1) {
    throw invalid(`${path}.below.confidence`, 'be between `0` and `1`');
  }
  return [...targets, ...targetsOf(`${path}.below.to`, below.to, ids)];
}

/**
 * Validates a node id or a non-empty list of them and returns the ids.
 */
function targetsOf(path: string, value: unknown, ids: ReadonlySet<string>): string[] {
  const targets = isArray(value) && !isEmpty(value) ? value : [value];
  for (const target of targets) {
    if (!isString(target) || !ids.has(target)) {
      throw invalid(path, 'name a node or a list of nodes');
    }
  }
  return targets as string[];
}

/**
 * Rejects a model that is set but not a non-empty string.
 */
function validateModel(path: string, model: unknown): void {
  if (!isUndefined(model) && !isText(model)) throw invalid(path, 'be a non-empty model name');
}

/**
 * Whether a value is a non-empty string.
 */
function isText(value: unknown): value is string {
  return isString(value) && value !== '';
}

/**
 * The failure for one option that breaks its rule.
 */
function invalid(option: string, rule: string): Error {
  return ohneError({
    title: 'Invalid flow definition',
    body: [`\`${option}\` must ${rule}.`],
  });
}
