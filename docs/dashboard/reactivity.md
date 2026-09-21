# Reactivity

ohne ships a small reactive core in `ohnejs/utils`: values that know who reads them, and effects
that re-run when those values change. It is what makes [dashboard bindings](./rendering.md#updates)
live, but nothing in it touches the DOM. The same primitives run anywhere, on the server or in the
browser. Dashboard pages import it the same way, through the
[import map](./pages.md#what-a-page-may-import).

```ts
import { effect, ref } from 'ohnejs/utils';

const count = ref(0);

effect(() => console.log(count.value)); // logs 0

count.value = 1; // logs 1
count.value = 1; // nothing - the value did not change
```

## ref

A `ref` is a box with one property, `value`. Reading `.value` inside an effect or computed
subscribes it to the ref, and writing a different value notifies every subscriber. Different means
`Object.is`-different, so writing the value it already holds does nothing.

```ts
const user = ref<{ name: string } | null>(null);

user.value;                   // -> null
user.value = { name: 'Ada' }; // subscribers re-run
```

Only `.value` itself is reactive. Changing something inside a stored object notifies nobody, so
assign a new value to signal a change.

## computed

`computed` derives a value and caches it. It computes lazily: on the first `.value` read, and after
that only when a dependency changed and you read it again. So an unused computed costs nothing.
Reading it inside an effect or another computed subscribes, exactly like a ref. Its `.value` is
read-only.

```ts
import { computed, ref } from 'ohnejs/utils';

const a = ref(1);
const b = ref(2);
const sum = computed(() => a.value + b.value);

sum.value;    // -> 3
a.value = 10;
sum.value;    // -> 12, re-evaluated
sum.value;    // -> 12, cached
```

An effect never reads an old value from a computed. When a write notifies its subscribers, every
affected computed is invalidated before any effect runs.

## effect

`effect` runs its function immediately, tracks every `.value` it reads, and re-runs whenever one of
them changes. Re-runs are synchronous: when a write returns, its subscribers have already run.

Each run collects its dependencies again, so a branch that was not taken is not a dependency:

```ts
const loggedIn = ref(false);
const name = ref('Ada');

effect(() => {
  console.log(loggedIn.value ? name.value : 'anonymous');
}); // logs 'anonymous'

name.value = 'Grace';  // nothing - `name` was not read on the last run
loggedIn.value = true; // logs 'Grace'
```

`effect` returns a stop function. Once called, the effect detaches from everything it tracked and
never runs again:

```ts
const stop = effect(() => console.log(count.value));

stop();
count.value = 2; // nothing
```

## batchedEffect

`batchedEffect` is `effect` with delayed re-runs. The first run is synchronous, but a change
schedules the re-run on a microtask, so many synchronous writes cause one re-run.

```ts
import { batchedEffect, ref } from 'ohnejs/utils';

const count = ref(0);

batchedEffect(() => console.log(count.value)); // logs 0

count.value = 1;
count.value = 2;
// one microtask later: logs 2, once
```

Use it when the effect does real work, like rendering or measuring, and the states in between do
not matter. Its stop function also cancels a pending re-run, so a stopped effect never fires late.

The dashboard renderer uses it like any other code: [`h`](./rendering.md#updates) wraps every
function attribute and child in a `batchedEffect`.

## untracked

`untracked` runs a function with tracking turned off: the `.value` reads inside do not subscribe
the surrounding effect. It returns whatever the function returns.

```ts
import { effect, ref, untracked } from 'ohnejs/utils';

const items = ref(['a', 'b']);
const page = ref(1);

effect(() => {
  console.log(items.value.length, untracked(() => page.value));
});

page.value = 2;          // nothing - `page` was read untracked
items.value = ['a'];     // logs 1 2
```

Use it for values an effect wants to read but not react to, like a snapshot, a counter, or a
default.

## effectScope

`effectScope` groups effects so you can stop them together. The scope owns everything created
inside its `run`: effects, computeds, and nested scopes. `dispose()` stops it all at once.
`onCleanup` registers a callback that runs when the active scope is disposed:

```ts
import { effect, effectScope, onCleanup, ref } from 'ohnejs/utils';

const scope = effectScope();
const count = ref(0);

scope.run(() => {
  effect(() => console.log(count.value)); // logs 0
  onCleanup(() => console.log('bye'));
});

count.value = 1; // logs 1
scope.dispose(); // logs 'bye'
count.value = 2; // nothing
```

- A scope created inside another scope's `run` is owned by the outer one, so disposing the outer
  scope disposes the inner one too.
- Disposal is idempotent: disposing a scope a second time does nothing.
- `onCleanup` outside any scope does nothing.
