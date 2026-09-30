# Flows

A flow sends one kind of question down a path you lay out. A [skill](./skills.md) gives the
[assistant](./assistant.md) instructions and leaves the rest to the model. A flow settles the path
first: a model sorts the question, then each step runs the assistant with only the instructions,
model and routes that step needs. Put one file per flow in your project's `flows/` folder:

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
      next: { on: 'intent', cases: { translate: 'translate', roster: 'roster' } },
    },
    translate: { act: { skill: 'translate-items' } },
    roster: { act: { prompt: 'Answer from Characters.', tiers: ['read'] } },
  },
});
```

The file name is the flow's name, here `raid-officer`. Each entry in `nodes` is one step: a decide
node picks where to go, an act node runs the assistant, and `start` names the first. Typed as
`/raid-officer Who is level 60?`, the question goes from `triage` to `roster`, which can read but
never write.

## Deciding

`questions` holds the one question a decide node asks, by name. Here `triage` learns a `loot`
intent:

```ts
questions: {
  intent: {
    choice: {
      translate: 'Translate or localize records',
      roster: 'Who is in the guild: levels, classes, attendance',
      loot: 'Hand out or record loot',
    },
  },
},
```

- `choice` always picks one of its keys. The model reads the question's name, each key and the
  sentence beside it, then judges the message. Add a key such as `other: 'Anything else'` so an
  off-topic message has somewhere to go.
- `score` picks one level of an ordered list, lowest first: `{ score: ['common', 'rare', 'epic'] }`.
- `yesNo` asks a question answered `yes` or `no`: `{ yesNo: 'Does it name a locale?' }`.
- A decide node sees only the words the person typed, never record data or what an earlier node
  did. It shows the person nothing.

## Routing

A decide node's `next` picks where to go from one answer:

```ts
next: {
  on: 'intent',
  cases: { translate: 'translate', roster: 'roster', loot: ['history', 'loot'] },
  below: { confidence: 0.6, to: 'general' },
},
```

- `on` names the question, and each `cases` key is one of its options: a `choice` key, a `score`
  level, or `yes` and `no`.
- Every answer comes with a confidence from `0` to `1`. A chat model reports how sure it is, and
  [Jev](#models-for-deciding) computes it. For `yesNo`, `0.6` means at least 80% sure either way.
- `below` catches an unsure model: an answer under `0.6` confidence goes to `general`, whatever it
  was.
- An answer without a case ends that path. If nothing else is left to run, the person sees that
  the assistant found nothing to do, so give every option a case or set `below`.

## Acting

`act` sets what the assistant does in a node, and within which limits:

```ts
loot: {
  act: {
    prompt: 'Record the loot the officer names on the winner in Characters.',
    tiers: ['read', 'write'],
  },
},
general: { act: {} },
```

- `skill` follows a [skill](./skills.md)'s instructions, and `prompt` adds to them or stands alone.
  With neither, as in `general`, the node runs the plain assistant.
- `tiers` offers only the routes of those [tiers](./policy.md#routes-it-may-use): `['read']` can
  never write, and `[]` proposes nothing. Omitted, every tier is open. A skill is instructions
  only, so it never narrows the routes. Only `tiers` does.
- `model` runs the node on another `ai.models` entry. Omitted, it runs on the model the person
  picked.
- The node is done when the assistant answers without proposing more. A request waiting for
  approval pauses it until the person decides.

## Chains and lists

An act node's `next` runs once it is done:

```ts
history: {
  act: { prompt: 'List who received loot in the last four raids.', tiers: ['read'] },
},
loot: {
  act: {
    prompt: 'Record the loot the officer names on the winner in Characters.',
    tiers: ['read', 'write'],
  },
  next: 'recap',
},
recap: { act: { prompt: 'Sum up what changed in one sentence.', tiers: [] } },
```

With `loot: ['history', 'loot']` in `triage`'s cases, a loot question runs `history`, then `loot`,
then `recap`:

- A list runs in order, never in parallel. A node's own `next` finishes before the next node in
  the list starts.
- Each node sees what the nodes before it did, as long as the model stays the same. A node on a
  different model than the one before it starts over from the typed question.

## What a person sees

1. In the palette, type `/`, the flow's name and the question: `/raid-officer Who is level 60?`.
   Without a question, the title is sent in its place.
2. Decide nodes pick the path and show nothing.
3. Each act node streams its answer into the same chat. Its requests wait for approval like any
   other.
4. The flow ends when nothing is left to run. A follow-up is a plain chat, without the flow.

A person needs the [`ai.use`](./assistant.md#who-may-ask) capability and every skill the flow's
act nodes use. One skill out of reach hides the whole flow. The step and token
[limits](./assistant.md#limits) count across the whole flow, and can stop it part-way. A flow
cannot give the model a route the person lacks: every request still goes through the same approval.

## Models for deciding

Deciding needs no big model. A decide node runs on the first of these that is set:

- its own `decide.model`
- `ai.decide`
- the model the person picked, else `ai.model`

Any chat model can decide. [Jev](https://typesafe.ai) is a model built to answer typed questions:

```ts
ai: {
  decide: 'router',
  models: {
    router: { provider: 'jev', model: 'jev-latest', key: 'TYPESAFE_API_KEY' },
  },
},
```

A `jev` model can only decide. The boot refuses it as an act node's model.

## Mistakes it catches

A flow that could not run fails when the file loads or the server boots:

- a node id `nodes` lacks, or a case for an option its question does not have
- a decide node without a branch, or with a question its branch does not route `on`
- a node `start` never reaches
- decide nodes that route in a loop with no act node between them
- an unknown skill or model, or a `jev` model on an act node

## Across layers

Flows are scanned from every [layer](../project/layers.md). A closer layer's flow replaces a
further one's with the same name, and `disable.flows` drops one by name, as
[skills](./skills.md#across-layers) are.
