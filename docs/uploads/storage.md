# Storage

A file is stored under its path, `photos/2024/sunset.jpg`, and a folder is a prefix. The `fs`
backend keeps that layout under `uploads.url`, `.uploads` by default, resolved against your app's
root. The `UPLOADS_URL` env var overrides `url`.

## Storing files in S3

For S3 and S3-compatible services, install
[`@ohnejs/uploads-s3`](https://github.com/ohnejs/uploads-s3).

```sh
pnpm add @ohnejs/uploads-s3
```

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads', '@ohnejs/uploads-s3'],
  uploads: { storage: 's3', url: 's3://my-bucket/uploads?region=eu-central-1' },
});
```

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The
[package README](https://github.com/ohnejs/uploads-s3#readme) covers bucket setup, private files,
and services such as R2 and MinIO.

## A backend of your own

Register a backend from a [boot file](../project/boot.md) and select it by name:

```ts
// boot/storage.ts
import { useStorages } from 'ohnejs/uploads';

import { createGCSStorage } from '../storage/gcs.ts';

useStorages().register('gcs', (url) => createGCSStorage(url));
```

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base', 'ohnejs/uploads'],
  uploads: { storage: 'gcs', url: 'gs://my-bucket/uploads' },
});
```

A backend implements `StorageAdapter`; its JSDoc names each method. The rules it cannot show:

- `move` and `delete` take a prefix as well as a file, so a folder is one call.
- The layer journals each effect inside the row's transaction and replays it after a crash, so a
  missing path must be a no-op.
- `setPrivate` locks an object a backend serves itself, as a row turns
  [private](./private-files.md). Without it, a private object stays readable at `publicURL`, and
  ohne warns at boot.
- `list` lets `ohne uploads prune` find [stray files](#stray-files). Without it, the command
  refuses.

## Stray files

A file can end up in storage with no row behind it, after a database restored from an older backup
or a file copied in by hand. The `ohne uploads prune` [command](../project/commands.md) lists those
files:

```sh
npx ohne uploads prune
```

Once the list holds only files you can lose, `--delete` deletes them. A file that is still uploading
is never among them.

`storage` and `url` are each layer's [own](../project/config.md#own-vs-inherited-keys): a dependency
cannot point your uploads at its storage.
