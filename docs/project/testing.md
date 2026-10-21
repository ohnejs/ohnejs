# Testing

Node's built-in test runner runs your tests, so there is nothing to install. A test boots your API
and sends it real requests.

Given a route `api/hello.get.ts` that returns `{ message: 'Hello' }`, this file tests it:

```ts
// tests/hello.test.ts
import type { AddressInfo } from 'node:net';

import { deepStrictEqual } from 'node:assert';
import { after, before, test } from 'node:test';
import { serveAPI, useEnv, useShutdown } from 'ohnejs';

let port: number;

before(async () => {
  useEnv().set('SILENT', true);
  useEnv().set('SKIP_CODEGEN', true);
  useEnv().set('DATABASE', ':memory:');
  useEnv().set('PORT', 0);
  const { server } = await serveAPI();
  port = (server.address() as AddressInfo).port;
});

after(() => useShutdown().run());

test('GET /hello greets', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/hello`);
  deepStrictEqual(await response.json(), { message: 'Hello' });
});
```

Run it with `npm test`.

## The test script

The scaffold's `test` script prepares the project, then runs every test file:

```sh
ohne prepare && node --test --import ohnejs/register "tests/**/*.test.ts"
```

- `ohne prepare` first brings `.ohne/` up to date, so the tests see your current routes and
  collections.
- `--import ohnejs/register` lets Node run the `.ts` files ohne ships inside `node_modules`. Without
  it, every test that imports `ohnejs` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

## Booting the API

`serveAPI` boots the app the way `ohne serve api` does. Before it, the test
[sets the environment](./env.md#overriding-in-code) it needs:

- `SILENT` keeps the test output clean.
- `SKIP_CODEGEN` leaves `.ohne/` alone. The script already generated it, and each test file runs in
  its own process, so the files would otherwise all rewrite it at once.
- `DATABASE=':memory:'` gives each file a fresh database.
- `PORT=0` picks a free port, which you read from `server.address()`.
- `useShutdown().run()` in `after` closes the server and the database.

After the boot, [`query`](../database/reading.md) works in a test, to seed records or assert on
them.

Dashboard modules need a browser, so keep the dashboard logic you want to test in plain functions
and test those.
