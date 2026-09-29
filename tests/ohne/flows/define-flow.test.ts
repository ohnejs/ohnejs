import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineFlow, type FlowDefinition, isOhneError } from '../../../src/ohne/index.ts';

/**
 * Matches the invalid-definition error whose body names `option`.
 */
function failsOn(option: string): (error: unknown) => boolean {
  return (error) =>
    isOhneError(error) &&
    error.message === 'Invalid flow definition' &&
    String(error.body).startsWith(`\`${option}\` must`);
}

/**
 * A flow of one decide node routing `intent` to two act nodes, with `patch` merged into the root.
 */
function triage(patch: object = {}): FlowDefinition {
  return {
    description: 'Routes a request.',
    start: 'triage',
    nodes: {
      triage: {
        decide: {
          questions: { intent: { choice: { translate: 'Translate.', roster: 'Roster.' } } },
        },
        next: { on: 'intent', cases: { translate: 'translate', roster: 'roster' } },
      },
      translate: { act: { skill: 'translate-items' } },
      roster: { act: { prompt: 'Answer from the roster.', tiers: ['read'] } },
    },
    ...patch,
  };
}

/**
 * `triage` with the `triage` node replaced.
 */
function withTriage(node: unknown): FlowDefinition {
  const flow = triage();
  return { ...flow, nodes: { ...flow.nodes, triage: node as never } };
}

describe('defineFlow', () => {
  it('returns the definition unchanged', () => {
    const definition = triage();
    strictEqual(defineFlow(definition), definition);
  });

  it('accepts every question form, a bare act, parallel targets and a `below` threshold', () => {
    const flow = defineFlow({
      title: { key: 'dashMenu.tools', params: { n: 2 } },
      description: 'Routes a request.',
      start: 'triage',
      nodes: {
        triage: {
          decide: {
            model: 'small',
            questions: {
              urgent: { yesNo: 'Is it urgent?' },
              effort: { score: ['low', 'high'] },
            },
          },
          next: {
            on: 'urgent',
            cases: { yes: ['now', 'log'], no: 'later' },
            below: { confidence: 0.5, to: 'later' },
          },
        },
        now: { act: { prompt: 'Act now.', model: 'big' }, next: 'log' },
        later: { act: {} },
        log: { act: { prompt: 'Log it.' } },
      },
    });
    deepStrictEqual(Object.keys(flow.nodes), ['triage', 'now', 'later', 'log']);
  });

  it('types every edge against the node ids', () => {
    throws(() =>
      defineFlow({
        description: 'd',
        start: 'a',
        // @ts-expect-error `b` is not a node id
        nodes: { a: { act: { prompt: 'x' }, next: 'b' } },
      }),
    );
  });

  it('rejects a bad description or title', () => {
    throws(() => defineFlow(triage({ description: undefined })), failsOn('description'));
    throws(() => defineFlow(triage({ title: 1 })), failsOn('title'));
  });

  it('rejects empty nodes or a `start` naming no node', () => {
    throws(() => defineFlow(triage({ nodes: {} })), failsOn('nodes'));
    throws(() => defineFlow(triage({ start: 'nowhere' })), failsOn('start'));
  });

  it('rejects a node with both or neither of `decide` and `act`', () => {
    throws(() => defineFlow(withTriage({ next: 'roster' })), failsOn('nodes.triage'));
    throws(
      () => defineFlow(withTriage({ act: { prompt: 'x' }, decide: {}, next: 'roster' })),
      failsOn('nodes.triage'),
    );
  });

  it('rejects a decide node without `next` or questions', () => {
    throws(
      () => defineFlow(withTriage({ decide: { questions: { q: { yesNo: 'Q?' } } } })),
      failsOn('nodes.triage.next'),
    );
    throws(
      () => defineFlow(withTriage({ decide: { questions: {} }, next: 'roster' })),
      failsOn('nodes.triage.decide.questions'),
    );
  });

  it('rejects a question of another shape', () => {
    const asking = (question: unknown) =>
      withTriage({ decide: { questions: { q: question } }, next: ['translate', 'roster'] });
    throws(
      () => defineFlow(asking({ choice: {} })),
      failsOn('nodes.triage.decide.questions.q.choice'),
    );
    throws(
      () => defineFlow(asking({ score: ['one'] })),
      failsOn('nodes.triage.decide.questions.q.score'),
    );
    throws(
      () => defineFlow(asking({ score: ['a', 'a'] })),
      failsOn('nodes.triage.decide.questions.q.score'),
    );
    throws(
      () => defineFlow(asking({ score: 'abcdefghijk'.split('') })),
      failsOn('nodes.triage.decide.questions.q.score'),
    );
    throws(() => defineFlow(asking({ yesNo: '' })), failsOn('nodes.triage.decide.questions.q'));
    throws(
      () => defineFlow(asking({ yesNo: 'Q?', choice: { a: 'A' } })),
      failsOn('nodes.triage.decide.questions.q'),
    );
  });

  it('rejects an act with an unknown tier or an empty model', () => {
    throws(
      () =>
        defineFlow(
          triage({ nodes: { a: { act: { prompt: 'x', tiers: ['admin'] } } }, start: 'a' }),
        ),
      failsOn('nodes.a.act.tiers'),
    );
    throws(
      () => defineFlow(triage({ nodes: { a: { act: { prompt: 'x', model: '' } } }, start: 'a' })),
      failsOn('nodes.a.act.model'),
    );
  });

  it('rejects an edge naming no node, or a branch on an act node', () => {
    const acting = (next: unknown) => triage({ nodes: { a: { act: {}, next } }, start: 'a' });
    throws(() => defineFlow(acting('b')), failsOn('nodes.a.next'));
    throws(() => defineFlow(acting([])), failsOn('nodes.a.next'));
    throws(() => defineFlow(acting({ on: 'q', cases: {} })), failsOn('nodes.a.next'));
  });

  it('rejects a branch on a question the node does not ask', () => {
    const flow = triage();
    const next = { on: 'mood', cases: { translate: 'translate' } };
    throws(
      () => defineFlow(withTriage({ ...flow.nodes.triage, next })),
      failsOn('nodes.triage.next.on'),
    );
  });

  it('rejects a case for an option its question lacks', () => {
    const flow = triage();
    const next = {
      on: 'intent',
      cases: { translate: 'translate', roster: 'roster', maybe: 'roster' },
    };
    throws(
      () => defineFlow(withTriage({ ...flow.nodes.triage, next })),
      failsOn('nodes.triage.next.cases.maybe'),
    );
    const yesNo = {
      decide: { questions: { q: { yesNo: 'Q?' } } },
      next: { on: 'q', cases: { yes: 'translate', true: 'roster' } },
    };
    throws(() => defineFlow(withTriage(yesNo)), failsOn('nodes.triage.next.cases.true'));
  });

  it('rejects a `below` confidence outside 0 to 1 or a target naming no node', () => {
    const flow = triage();
    const branch = { on: 'intent', cases: { translate: 'translate', roster: 'roster' } };
    throws(
      () =>
        defineFlow(
          withTriage({
            ...flow.nodes.triage,
            next: { ...branch, below: { confidence: 2, to: 'roster' } },
          }),
        ),
      failsOn('nodes.triage.next.below.confidence'),
    );
    throws(
      () =>
        defineFlow(
          withTriage({
            ...flow.nodes.triage,
            next: { ...branch, below: { confidence: 0.5, to: 'x' } },
          }),
        ),
      failsOn('nodes.triage.next.below.to'),
    );
  });

  it('rejects a node unreachable from `start`, listing each', () => {
    const flow = triage();
    const nodes = { ...flow.nodes, lost: { act: { prompt: 'x' } }, gone: { act: { prompt: 'y' } } };
    throws(
      () => defineFlow<string>({ ...flow, nodes }),
      (error) =>
        isOhneError(error) &&
        error.message === 'Invalid flow definition' &&
        String(error.body).includes('- `lost`') &&
        String(error.body).includes('- `gone`'),
    );
  });
});
