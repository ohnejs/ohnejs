# Skills

A skill teaches the [assistant](./assistant.md) one kind of work: how to do it with the routes the
person already has, and what to avoid. It is instructions only; it never runs code. Put one file
per skill in `skills/`:

```ts
// skills/translate-items.ts
import { defineSkill } from 'ohnejs';

export default defineSkill({
  title: 'Translate items',
  description: 'Translate item names and tooltips into another locale.',
  prompt: [
    'Find the items that lack the target locale: `_translations` does not include it.',
    'Rewrite `name` and `tooltip` into the locale the officer names.',
    'Lore names stay as they are: Thunderfury, Ashbringer, Sulfuras.',
    'Say how many items you translated, in one sentence.',
  ],
});
```

The file name is the skill's name, here `translate-items`. The model sees every skill's
description and reads a skill's `prompt` when the question calls for it. A person can also start
one on purpose: type `/` in the palette to list skills, pick one, and add the question after it.

## Options

- `title` and `description` take plain text or a [message key](../i18n/messages.md), so the
  palette shows them in the person's language. Omitted, the title is the name in sentence case.
- `prompt` is what the model follows: one string, or a list of lines joined with line breaks.
- `capability` hides the skill from anyone without that
  [capability](../auth/roles.md#capabilities):

```ts
capability: 'collection.Items.update',
```

## Across layers

Skills are scanned from every [layer](../project/layers.md). A closer layer's skill replaces a
further one's with the same name, and `disable.skills` drops one:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  disable: { skills: ['translate-items'] },
});
```

A skill cannot give the model a route the person lacks. What it asks for still goes through the
same approval as any other request.
