# Reactivity

ohne ships a small reactive core in `ohne/utils`: values that know who reads them, and effects that
re-run when those values change. It is what makes dashboard pages live, but nothing in it touches
the DOM - the same primitives run anywhere, server or browser.

```ts
import { effect, ref } from 'ohne/utils';

const count = ref(0);

effect(() => console.log(count.value)); // logs 0

count.value = 1; // logs 1
count.value = 1; // nothing - the value did not change
```

## ref

A `ref` is a box with one property, `value`. Reading `.value` inside an effect or computed
subscribes it to the ref; writing a different value notifies every subscriber. Different means
`Object.is`-different, so writing the value it already holds is a no-op.

```ts
const user = ref<{ name: string } | null>(null);

user.value;                   // -> null
user.value = { name: 'Ada' }; // subscribers re-run
```

Reactivity lives at the `.value` boundary. Mutating the inside of a stored object notifies nobody -
to signal a change, assign a new value.

## computed

`computed` derives a value and caches it. The getter runs on the first `.value` read; after that it
re-runs only when something it read has changed, and only when the value is read again - an unused
computed costs nothing. Reading it inside an effect or another computed subscribes, exactly like a
ref. Its `.value` is read-only.

```ts
import { computed, ref } from 'ohne/utils';

const a = ref(1);
const b = ref(2);
const sum = computed(() => a.value + b.value);

sum.value;    // -> 3
a.value = 10;
sum.value;    // -> 12, re-evaluated
sum.value;    // -> 12, cached
```

An effect never sees a stale computed: when a write fans out, every affected computed is
invalidated before any effect runs.

## effect

`effect` runs its function immediately, tracks every `.value` it reads, and re-runs whenever one of
them changes. Re-runs are synchronous - by the time a write returns, its subscribers have run.

Each run tracks from scratch, so a branch that was not taken is not a dependency:

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

`batchedEffect` is `effect` with deferred re-runs: the first run is synchronous, but a change
schedules the re-run on a microtask, so many synchronous writes coalesce into one.

```ts
import { batchedEffect, ref } from 'ohne/utils';

const count = ref(0);

batchedEffect(() => console.log(count.value)); // logs 0

count.value = 1;
count.value = 2;
// one microtask later: logs 2, once
```

Reach for it when the effect does real work - rendering, measuring - and intermediate states are
noise. The stop function it returns also cancels a pending re-run, so a stopped effect never fires
late.

## untracked

`untracked` runs a function with tracking suspended: the `.value` reads inside do not subscribe the
surrounding effect. It returns whatever the function returns.

```ts
import { effect, ref, untracked } from 'ohne/utils';

const items = ref(['a', 'b']);
const page = ref(1);

effect(() => {
  console.log(items.value.length, untracked(() => page.value));
});

page.value = 2;          // nothing - `page` was read untracked
items.value = ['a'];     // logs 1 2
```

Use it for values an effect wants to read but not react to - a snapshot, a counter, a default.

## effectScope

`effectScope` groups effects for one disposal. Everything created inside its `run` - effects,
computeds, nested scopes - is owned by the scope, and `dispose()` stops it all at once.
`onCleanup` registers a teardown callback on the active scope:

```ts
import { effect, effectScope, onCleanup, ref } from 'ohne/utils';

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

A scope created inside another scope's `run` is owned by the outer one, so disposing the outer
scope cascades. Disposal is idempotent, and `onCleanup` outside any scope is a no-op.

## Server and browser

The core is plain TypeScript with no DOM and no Node APIs, so a ref behaves identically in a route
handler, a test, and a dashboard page. In the browser, `ohne/utils` resolves through the served
import map - the import line above works unchanged on both sides.

The dashboard renderer is a consumer like any other: `h` wraps every function prop and child in a
`batchedEffect`, so the text and attributes that read a ref patch when it changes. See
[rendering](./rendering.md).
