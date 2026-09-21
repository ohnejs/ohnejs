# Rendering

The dashboard renders with plain DOM. `h` creates real elements, and you turn on reactivity per
value: wrap a value in a function and the runtime keeps that one place up to date. There is no
virtual DOM and no re-render. A change patches exactly the text node or attribute it touches.

```ts
// dashboard/pages/index.ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

export default defineDashboardPage(() => {
  const count = ref(0);
  return h('button', { onClick: () => count.value++ }, () => `Count: ${count.value}`);
});
```

The component body runs once. The function child is a live binding: it reads `count`, so each
click rewrites the button's text and nothing else runs again. The primitives the bindings use,
[`ref`](./reactivity.md#ref), [`computed`](./reactivity.md#computed), and
[`effect`](./reactivity.md#effect), are described in reactivity.

## Elements

`h(tag, props, ...children)` returns a real `HTMLElement`. Children are appended in order. An
element is a child too, so you can nest `h` calls directly. Pass `null` for props when there are
none:

```ts
h('article', { class: 'post' },
  h('h2', null, post.title),
  h('p', null, post.excerpt),
);
```

## Props

Props set attributes, not DOM properties, so it is `class`, not `className`. A prop's value decides
what it becomes:

- An `on*` key with a function value binds an event listener. The event is the key after `on`,
  lowercased, so `onClick` listens to `click` and `onInput` to `input`.
- Any other function value is a live attribute, re-applied when a ref it reads changes.
- Anything else sets a static attribute once.

When an attribute is applied:

- `false`, `null`, and `undefined` remove it.
- `true` sets it empty.
- Any other value is converted to a string.

```ts
const saving = ref(false);

h('button', { disabled: () => saving.value, onClick: () => (saving.value = true) }, 'Save');
```

## Children

How a child renders depends on what it is:

- a `Node` is inserted as-is,
- a string or number becomes a text node,
- an array inserts its items in order,
- `null`, `undefined`, and booleans render nothing, so a static `loggedIn && h('a', null, 'Out')`
  simply disappears,
- a function is a live binding.

A function child re-runs when a ref it read changes, and it may return any child - not just text.
A binding over a single text node patches the text in place. One that returns different nodes
clears its region and rebuilds it, so a binding can swap whole subtrees:

```ts
const user = ref<{ name: string } | null>(null);

h('header', null, () => (user.value ? h('strong', null, user.value.name) : 'Guest'));
```

## Updates

Every live binding is a [`batchedEffect`](./reactivity.md#batchedeffect): it runs once while the
element is built, and writes in one tick make one DOM update.

When a binding replaces its content, effects created inside the old content are
[stopped with it](./reactivity.md#effectscope), so no old effect keeps reacting.

## Lists

`each` renders a keyed list and updates it in place as the array changes:

```ts
import { each, h } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

const todos = ref([
  { id: 1, text: 'buy milk' },
  { id: 2, text: 'write docs' },
]);

h('ul', null, each(
  () => todos.value,
  (todo) => todo.id,
  (todo, index) => h('li', null, () => `${index() + 1}. ${todo().text}`),
));
```

The first argument is a function, so the list is live: assign a new array and the DOM updates to
match.

- The second argument returns a stable, unique key per item. A keyed row keeps its DOM and state
  across moves, so reordering the array moves nodes instead of rebuilding them.
- The render callback runs once per row and receives accessors, not values. Read `todo()` and
  `index()` inside a binding, so the row updates in place when its item or position changes.
- A removed row's effects are disposed with its nodes.

Rows compare items by identity (`Object.is`), so create a new object for a changed item. If you
change the old object in place, the row does not notice:

```ts
todos.value = todos.value.map((t) => (t.id === 1 ? { ...t, text: 'buy oat milk' } : t));
```

## Conditionals

`when` renders a branch by truthiness:

```ts
import { h, when } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

const open = ref(false);

h('section', null,
  h('button', { onClick: () => (open.value = !open.value) }, 'Toggle'),
  when(
    () => open.value,
    () => h('p', null, 'Details, shown while open'),
  ),
);
```

- The second argument renders while the condition is truthy.
- An optional third renders while it is falsy. Without it, falsy renders nothing.

The branch rebuilds only when the condition changes between truthy and falsy. A change from one
truthy value to another keeps the branch's DOM, and bindings inside it keep updating on their own.
`when` returns a function child, so you can use it wherever a child goes.

## Mounting

`mount(view, container)` clears the container and renders a view into it. The router mounts your
pages for you, so you need `mount` only when rendering into a DOM node you own:

```ts
import { h, mount } from 'ohnejs/dashboard';

mount(h('h1', null, 'ohne'), document.querySelector('#widget')!);
```

## Navigation

The router renders the page matching the current URL. [Navigation](./pages.md#navigation) covers
links, `navigate`, and the back and forward buttons, and
[the page component](./pages.md#the-page-component) covers the route context a page receives.
