# Transforms

Translating, rephrasing and fixing text needs the text itself. The planning model does not read it.
It proposes a transform, and a separate model call rewrites the fields. That call gets no tools, so
record text can never make it act. The person sees every change before anything is sent.

A transform only rewrites fields the model may see, so list them in `ai.data`:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/ai'],
  ai: {
    model: 'claude',
    models: {
      claude: { provider: 'anthropic', model: 'claude-opus-5-5', key: 'ANTHROPIC_API_KEY' },
    },
    data: { Items: ['name', 'tooltip'] },
  },
});
```

Now "translate every epic item to German" works: the person gets a table of each item's current
`name` and `tooltip` beside the German, edits any cell, and approves.

## What gets rewritten

- Only text fields that `ai.data` opens and the person may both read and update.
- At a locale, only [translatable](../database/translations.md) fields. A record that holds the
  locale is rewritten in place; one that lacks it is translated from the default locale.
- Records outside the person's reach are skipped and counted, never read.
- At most `ai.limits.transform` records per proposal, 200 by default. The model proposes again
  for the rest.

## Which model rewrites

The turn's model, unless you pin one:

```ts
ai: {
  transform: { model: 'local' },
},
```

- Pinning keeps record text with one provider, such as a model on your own server.
- Without a pin, the person can retry a rewrite on any other model that may see values.
- A model with `data: false` never rewrites.

A transform always asks, even with [auto-accept](./assistant.md#auto-accept) on, and its tokens
count toward the person's budget like any other call.
