# Feedback

Feedback tells the reader what just happened, or asks before something happens. A toast reports an
outcome and goes away on its own. A confirmation and a dialog stop and wait for an answer.

```ts
// dashboard/pages/guild.ts
import { button, confirm, defineDashboardPage, page, toast } from 'ohnejs/dashboard';

export default defineDashboardPage(() =>
  page(
    { title: 'Guild' },
    button('Disband the guild', {
      variant: 'destructive',
      onClick: async () => {
        const yes = await confirm({
          title: 'Disband the guild?',
          action: 'Disband',
          destructive: true,
        });
        if (yes) toast('The guild is disbanded', { type: 'success' });
      },
    }),
  ),
);
```

Inside the [frame](./pages.md#the-frame), the toast stack and the dialog are already mounted. A page
with `frame: false` wraps its content in `base(...)`, which mounts them.

## Toast

`toast` shows a short message at the top of the page:

```ts
toast('Raid roster saved', { type: 'success' })
toast({ key: 'dashboard.foundErrors', params: { count: 2 } }, { type: 'error' })
```

- `type` is `default`, `success`, `error`, `info`, or `warning`. Every type but `default` leads
  with its icon.
- The message takes a [message key or plain text](./components.md), and backticked
  values highlight.
- A toast stays 4 seconds. Hovering the stack pauses it.

[`useAction`](./data.md#writing-with-useaction) already toasts a failed write, so you add a toast
only for success.

## More in a toast

A toast can carry a second line, a button, and a close button:

```ts
toast('Baine was removed from the roster', {
  description: 'He was the last warrior in group two.',
  action: { label: 'Undo', onClick: () => restore('Baine') },
  closeButton: true,
})
```

- Clicking the `action` dismisses the toast after its `onClick`.
- `duration: Infinity` keeps a toast until it is dismissed.
- `toast` returns an id. Pass it as `id` to update the showing toast in place, or to
  `dismissToast(id)` to close it.
- `queueToast` with `showAfterRouteChange: true` holds a toast until the next navigation, for a
  message that must survive one.

## Confirm

`confirm` asks before an action and resolves `true` when the reader agrees:

```ts
const yes = await confirm({
  title: 'Start `Icecrown Citadel`?',
  body: 'Everyone in the group is summoned to the entrance.',
  action: 'Start',
});
```

- Cancel, Escape, and a click outside resolve `false`.
- `destructive: true` paints the agreeing button destructive, for what cannot be undone.
- Ask a question in `title`, and name the action in `action`: "Disband", never "OK".

## Dialog

`openDialog` is the general form, with buttons you name yourself. It resolves with the name of the
one the reader clicked:

```ts
const side = await openDialog({
  content: 'Which side does **Thrall** fight for?',
  actions: [
    { name: 'alliance', label: 'Alliance' },
    { name: 'horde', label: 'Horde', variant: 'primary' },
  ],
});
```

- `side` is typed `'alliance' | 'horde' | undefined`. Escape and a click outside resolve
  `undefined`.
- The content is markdown-lite, like `**bold**`, backticks, and links. `markdown: false` shows
  plain text.
- An action's `variant` takes the [button variants](./actions.md#variants-and-sizes), `outline` by
  default.
- One dialog shows at a time. Opening another replaces it, and the first promise never settles.
