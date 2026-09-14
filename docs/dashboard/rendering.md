# Rendering

The dashboard renders with plain DOM. `h` creates real elements, and reactivity is opt-in per
value: wrap a value in a function and the runtime keeps that one spot in sync. There is no virtual
DOM and no re-render - a change patches exactly the text node or attribute it touches.

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
click rewrites the button's text and nothing else runs again. The primitives the bindings consume -
`ref`, `computed`, `effect` - live in [reactivity](./reactivity.md).

## Elements

`h(tag, props, ...children)` returns a real `HTMLElement`. Children append in order, and since an
element is a child too, `h` calls nest directly. Pass `null` for props when there are none:

```ts
h('article', { class: 'post' },
  h('h2', null, post.title),
  h('p', null, post.excerpt),
);
```

## Props

A prop's value decides what it becomes:

- an `on*` key with a function value binds an event listener - the event is the key after `on`,
  lowercased, so `onClick` listens to `click` and `onInput` to `input`,
- any other function value is a live attribute, re-applied when a ref it reads changes,
- anything else sets a static attribute once.

When an attribute is applied, `false`, `null`, and `undefined` remove it, `true` sets it empty,
and any other value is stringified. Props set attributes, not DOM properties - so it is `class`,
not `className`:

```ts
const saving = ref(false);

h('button', { disabled: () => saving.value, onClick: () => (saving.value = true) }, 'Save');
```

`disabled` starts absent and appears the moment `saving` flips - the exact boolean-attribute
behavior HTML expects.

## Children

A child renders by what it is:

- a `Node` is inserted as-is,
- a string or number becomes a text node,
- an array splices its items in order,
- `null`, `undefined`, and booleans render nothing - a static `loggedIn && h('a', null, 'Out')`
  simply disappears,
- a function is a live binding.

A function child re-runs when a ref it read changes, and it may return any child - not just text.
A binding over a single text node patches the text in place; one that returns different nodes
clears its region and rebuilds it, so a binding can swap whole subtrees:

```ts
const user = ref<{ name: string } | null>(null);

h('header', null, () => (user.value ? h('strong', null, user.value.name) : 'Guest'));
```

## Updates

Every live binding runs once synchronously while the element is built, then again whenever a ref
it read changes. Re-runs are batched on a microtask, so many synchronous writes coalesce into one
DOM update:

```ts
const n = ref(0);
const span = h('span', null, () => n.value);

n.value = 1;
n.value = 2; // one microtask later the span updates once, to 2
```

When a binding replaces its content, effects created inside the old content are stopped with it -
nothing left behind keeps reacting.

## Lists

`each` renders a keyed list that reconciles in place as the array changes:

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

The first argument is a function, so the list is live: assign a new array and the DOM reconciles.
The second returns a stable, unique key per item - keyed rows keep their DOM and state across
moves, so reordering the array moves nodes instead of rebuilding them.

The render callback runs once per row and receives accessors, not values: read `todo()` and
`index()` inside a binding to keep the row live. A row whose item or position changed updates
through those reads without a rebuild, and a removed row's effects are disposed with its nodes.

Rows compare items by identity (`Object.is`), so produce a changed item as a new object - an
in-place mutation of the old one goes unnoticed:

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

The second argument renders while the condition is truthy; an optional third renders while it is
falsy. Without it, falsy renders nothing.

The branch swaps only when the truthiness flips - a change from one truthy value to another
leaves the branch's DOM standing, and bindings inside it keep updating on their own. `when`
returns a function child, so it drops in wherever a child goes.

## Mounting

`mount(view, container)` clears the container and renders a view into it. The router mounts your
pages for you, so you reach for `mount` only when rendering into a DOM node you own:

```ts
import { h, mount } from 'ohnejs/dashboard';

mount(h('h1', null, 'ohne'), document.querySelector('#widget')!);
```

## Navigation

Pages live under `dashboard/pages/` - the file convention is covered in [pages](./pages.md). The
router renders the page matching the current URL and swaps it in place on navigation, without a
full reload. Three things navigate:

- a left-click on a same-origin link - `h('a', { href: '/posts' }, 'Posts')` just works. Clicks
  the browser should own pass through: a modified click, another origin, a `target`, a
  `download`, and an in-page `#` anchor on the same path,
- `navigate(path)`, the programmatic form - a no-op when you are already there,
- the back and forward buttons.

```ts
import { h, navigate } from 'ohnejs/dashboard';

h('button', { onClick: () => navigate('/posts') }, 'Open posts');
```

A page component receives the route context:

```ts
// dashboard/pages/posts/[id].ts
import { defineDashboardPage, h } from 'ohnejs/dashboard';

export default defineDashboardPage((route) => h('h1', null, `Post ${route.params.id}`));
```

`route.params` holds the captured segments, URI-decoded; `route.path` is the matched location
path. Page modules load on demand - a page's code is fetched the first time its route renders -
and a URL no page matches renders the dashboard's not-found page.
