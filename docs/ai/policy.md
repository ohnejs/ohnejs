# Assistant policy

Everything the ai layer tells the model, and every list that decides what it may reach, is config
your app can replace. Start by adding lines of your own:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/ai'],
  ai: {
    instructions: [
      'You help officers of <Onyx Vanguard> run their guild.',
      'Never delete a Character; set `status` to `retired` instead.',
      'Lore names stay untranslated: Thunderfury, Ashbringer, Sulfuras.',
    ],
  },
});
```

The model reads these after the framework's own prompts, on every question.

Each rule the prompts state is also enforced by the server: a route that is not offered cannot be
proposed, and the person approves every write. Rewording a prompt changes what the model reads,
never what it can do.

## Prompts

`ai.prompts` holds each text the framework ships. Set one to replace it:

```ts
ai: {
  prompts: {
    guard: '# Rules\nYou work for one officer. Propose only the routes listed below.',
  },
},
```

- `guard` - the rules, first in every prompt.
- `operator` - how the API works: routes, filters, locales, receipts.
- `transform` - what the tool-less model reads when it [rewrites text](./transforms.md).
- `reminder` - the line that closes every prompt.
- `decide` - what a [flow's](./flows.md) decide step reads.

`''` drops a block. To keep a default and add to it, read it from `AI_DEFAULTS`:

```ts
import { AI_DEFAULTS } from 'ohnejs/ai';

const guard = `${AI_DEFAULTS.prompts.guard}\n- Never touch archived raids.`;
```

## Collections it never reaches

`ai.deny.collections` lists collections the model can neither request nor filter through:

```ts
ai: {
  deny: { collections: [...AI_DEFAULTS.deny.collections, 'Invoices'] },
},
```

- Omitted, it is `Users`, `Sessions` and `AITurns`.
- A denied collection has no route, and a `has` or `populate` into it is refused.
- Removing `Users` lets the model change accounts the person may change, passwords and roles
  included. Do that only on purpose.

## Routes it may use

`ai.routes` maps route patterns to a tier. The model sees only the routes that match, and the
tier decides how a request is treated:

```ts
ai: {
  routes: {
    ...AI_DEFAULTS.routes,
    'DELETE /collections/[collection]/[uuid]': false,
    'POST /reports/[name]': 'read',
  },
},
```

- `read` runs without asking; `write` asks; `destructive` asks with a second click.
- `false` forbids a route. The first matching pattern wins, and a route no pattern matches is
  never offered.
- Omitted, the table offers the [collections API](../api/collections.md) routes and
  [`POST /search`](../dashboard/palette.md#searching-from-your-code). A blind model learns only how
  many records a search found per collection, never which.
- A table you set replaces the default whole, so spread `AI_DEFAULTS.routes` to extend it.
- Routes under `/auth/` and `/ai/` are never offered, whatever the table says. A request there
  would act on the person's session or on the assistant itself.

## One rule for layers

A layer below your app can set none of these: only the app's own `ai` config counts. The one
exception is `instructions`, which every layer adds to, the app's lines first.
