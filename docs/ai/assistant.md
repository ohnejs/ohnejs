# The assistant

The ai layer puts an assistant behind Cmd+K in the dashboard. A person asks in plain words, the
model proposes the HTTP requests that would do it, and the person approves them. Their own browser
then sends each request with their own session, exactly as if they had clicked through the
dashboard. So the assistant can never do more than the person can.

It is a [layer](../project/layers.md#consuming-a-layer), so an app that does not want it does not
stack it:

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
  },
});
```

Set `ANTHROPIC_API_KEY` in your [environment](../project/env.md), and the
[search palette](../dashboard/palette.md) gains an "Ask" row for everyone holding the `ai.use`
[capability](../auth/roles.md). Without a model or its key, Cmd+K stays a search.

## Models

`ai.models` names each model you use; `ai.model` picks the one the assistant plans with:

```ts
models: {
  claude: { provider: 'anthropic', model: 'claude-opus-5-5', key: 'ANTHROPIC_API_KEY' },
  gpt: { provider: 'openai', model: 'gpt-5', key: 'OPENAI_API_KEY' },
  local: {
    provider: 'openai-compatible',
    model: 'qwen3',
    baseURL: 'http://localhost:11434/v1',
    key: false,
  },
},
```

- `provider` is the wire protocol. `anthropic` and `openai` talk to those APIs;
  `openai-compatible` talks to any server that speaks Chat Completions, such as Ollama, vLLM,
  OpenRouter, Groq or Mistral, at its `baseURL`.
- `key` names the environment variable that holds the API key. The key never leaves the server.
  `false` sends none, for a local server.
- `headers` and `options` pass provider-specific headers and request fields through unchanged.
- A person may pick another entry for a question in the palette. Omitted, `ai.model` answers.

## What a person sees

1. Cmd+K, type a question, and choose "Ask".
2. The model's answer streams in. Reads run at once.
3. Writes wait in a table: each record, what changes, a checkbox. Approve some, all, or decline
   with a note for the model.
4. The browser sends what was approved, and the model says what happened.

A delete, or a write to many records at once, always asks. The person can close the palette while
the assistant works; a button in the header brings them back.

Ask it to open something, and it opens it: any page the person's
[sidebar](../dashboard/pages.md#the-sidebar) shows, their account, or a record it has read.

Chats are kept on the server, visible only to the person who asked, and reopen from "Recent chats"
in Cmd+K. They last as long as `ai.audit.retain` keeps turns: `'90d'` by default, `false` to keep
them all.

## What reaches the model

By default the model is **blind**. It gets your schema, the routes the person may use, the pages
they may open, and after each request a receipt: the status, counts, and record ids. It never sees
a field's value, so it can find, count and change records, but not read them.

To let it read values, list collections, and optionally fields, in `ai.data`:

```ts
ai: {
  data: {
    Items: true,
    Characters: ['name', 'class', 'level'],
  },
},
```

- Only listed fields leave the server, and only when the person may read them.
- `Users`, `Sessions` and `AITurns` never do.
- A model entry with `data: false` stays blind whatever `ai.data` says.

Translating or rewriting text needs the values too. It runs as a
[transform](./transforms.md): a separate model call that never gets tools.

## Who may ask

The assistant needs the `ai.use` capability. The `admin` role holds everything, so admins have it;
give it to other roles as you would any capability:

```ts
// roles/officer.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.*', 'ai.use'],
});
```

## Auto-accept

Some edits are safe enough to skip the table. List them, and cap how many one question may apply:

```ts
ai: {
  autoAccept: { max: 20, fields: { Items: ['name', 'tooltip'] } },
},
```

- Each person decides for themselves: a switch on their [account page](../dashboard/account.md)
  turns it on. Nobody can turn it on for someone else.
- A write runs unasked only when every key it sends is listed, and the question stays within `max`.
- Writes to many records at once and [transforms](./transforms.md) always ask.
- Deletes and writes at a locale ask too, as long as `ai.autoAccept.ask` lists them, which it does
  by default.
- What ran without asking still shows in the palette, collapsed.

The switch is a field on `Users`. If your app overrides `collections/Users.ts`, spread
`aiUsersDefinition` from `ohnejs/ai` in place of `usersDefinition`.

## Limits

Every person has a budget, so one person cannot run up your bill:

```ts
ai: {
  limits: {
    turns: { limit: 30, window: '1h' },
    tokens: { limit: 1_000_000, window: '1d' },
  },
},
```

- `turns` counts questions and `tokens` counts what the provider bills, per person.
- `steps` caps model calls in one question, and `requests` the requests in one step.
- A step the person leaves before it ends is still charged.

The prompts, which routes the model may use, and what always asks are yours to change. See
[policy](./policy.md).
