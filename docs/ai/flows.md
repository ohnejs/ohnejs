# Flows

A flow routes a question through steps you define. A decide node asks a fast model what the
question is about; the answer picks the next node. An act node runs the
[assistant](./assistant.md) with a [skill](./skills.md) or a prompt, on the model you choose, and
within the request tiers you allow. Put one file per flow in `flows/`:

```ts
// flows/raid-officer.ts
import { defineFlow } from 'ohnejs';

export default defineFlow({
  title: 'Raid officer',
  description: 'Loot, rosters and translations for raid officers.',
  start: 'triage',
  nodes: {
    triage: {
      decide: {
        questions: {
          intent: {
            choice: {
              translate: 'Translate or localize records',
              roster: 'Who is in the guild: levels, classes, attendance',
            },
          },
        },
      },
      next: {
        on: 'intent',
        cases: { translate: 'translate', roster: 'roster' },
        below: { confidence: 0.6, to: 'general' },
      },
    },
    translate: { act: { skill: 'translate-items' } },
    roster: { act: { prompt: 'Answer from Characters.', tiers: ['read'] } },
    general: { act: {} },
  },
});
```

A person starts it from the palette: type `/`, pick "Raid officer", and ask. "Who is level 60?"
goes to `roster`, which can read but never write.

## Decide nodes

`questions` names what to ask. Each question is one of three kinds:

- `choice` picks one option; each option has a sentence the model reads.
- `score` picks one level of an ordered list, lowest first: `{ score: ['low', 'medium', 'high'] }`.
- `yesNo` answers its question with `yes` or `no`: `{ yesNo: 'Does it name a locale?' }`.

`next` routes `on` one question. `cases` maps each answer to a node, or to a list of nodes that run
one after another. An answer without a case ends the flow. With `below`, an answer the model is
less sure of than `confidence` goes to `to` instead.

A decide node reads only the person's question, never record data.

## Act nodes

- `skill` runs a [skill](./skills.md), and `prompt` adds instructions. With neither, the node runs
  the plain assistant.
- `tiers` limits the requests the node may propose: `['read']` can never write.
- `model` runs the node on another `ai.models` entry.
- `next` continues at another node once this one is done.

## Models for deciding

A decide node runs on its own `model`, else on `ai.decide`, else on the question's model. Any chat
model can decide. [Jev](https://typesafe.ai), a model built to answer typed questions, is faster
and cheaper at it:

```ts
ai: {
  decide: 'router',
  models: {
    router: { provider: 'jev', model: 'jev-latest', key: 'TYPESAFE_API_KEY' },
  },
},
```

A `jev` model can only decide; the boot refuses it as an act node's model.

Flows are scanned from every [layer](../project/layers.md), and `disable.flows` drops one by name,
as [skills](./skills.md#across-layers) are.
