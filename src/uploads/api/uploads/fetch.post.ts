import {
  badRequest,
  defineHandler,
  readJSONBody,
  setResponseStatus,
  tooManyRequests,
  useRequest,
} from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { createPermits, isNull, isPlainObject, isString } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { readerReach } from '../../uploads/_reader.ts';
import { fetchUpload } from '../../uploads/fetch-upload.ts';

/**
 * The most fetches one process runs at once.
 */
const MAX_FETCHES = 8;

/**
 * The most fetches one user runs at once.
 */
const MAX_FETCHES_PER_USER = 2;

/**
 * The longest `url` accepted, since the whole of it goes out as the request line.
 */
const MAX_URL_LENGTH = 8 * 1024;

const permits = createPermits(MAX_FETCHES, MAX_FETCHES_PER_USER);

/**
 * `POST /uploads/fetch`
 *
 * Fetches the file at `{ url, directory?, name? }` into a new upload and answers `201` with its record.
 * Without a `name`, the response names the file, as `fetchUpload` describes.
 * Needs `collection.Uploads.create` and `uploads.fetch`: no user `401`, a missing capability `403`.
 * A missing or non-string `url`, one past 8192 characters, or a non-string `directory` or `name`, is a `400`.
 * A user already running `MAX_FETCHES_PER_USER` fetches, or a process running `MAX_FETCHES`, is a `429`.
 * A URL that fails to fetch is a `422` at `url`; a refused type or mismatching content a `422` at `name`.
 * A path past 768 bytes is a `422` at `directory`.
 * A write that would hide a row from the caller's read `access` scope is a `422`, and nothing changes.
 * A client that goes away aborts the fetch and frees its permit as soon as the server sees it leave.
 */
export default defineHandler(
  async (): Promise<UploadRecord> => {
    const user = await requireCapability('collection.Uploads.create');
    await requireCapability('uploads.fetch');
    const body = await readJSONBody<unknown>();
    const { url, directory = '', name = '' } = isPlainObject(body) ? body : {};
    if (!isString(url) || url.length > MAX_URL_LENGTH || !isString(directory) || !isString(name)) {
      throw badRequest();
    }
    const reach = await readerReach();
    const release = permits.acquire(user.UUID);
    if (isNull(release)) throw tooManyRequests();
    const { signal } = useRequest();
    signal.addEventListener('abort', release, { once: true });
    try {
      setResponseStatus(201);
      return await fetchUpload({ url, directory, name, author: user.UUID, reach, signal });
    } finally {
      release();
    }
  },
  { handlerTimeout: false },
);
