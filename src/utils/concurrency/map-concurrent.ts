import { isUndefined } from '../is/is-undefined.ts';

/**
 * Maps `items` through the async `fn`, running at most `limit` calls at once.
 * Results keep the input order, whatever order the calls settle in.
 * After the first rejection nothing new starts; the promise rejects with it once in-flight calls settle.
 * A limit below `1` throws: no call could ever start.
 *
 * @example
 * ```ts
 * await mapConcurrent([1, 2, 3], 2, async (n) => n * 10)    // -> [10, 20, 30]
 * await mapConcurrent(parts, 4, (part) => uploadPart(part)) // -> each part's result, in order
 * ```
 */
export async function mapConcurrent<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`Invalid concurrency limit: ${limit}`);
  const queue = [...items];
  const results: R[] = [];
  let next = 0;
  let failure: { error: unknown } | undefined;
  const work = async (): Promise<void> => {
    while (next < queue.length && isUndefined(failure)) {
      const index = next++;
      try {
        results[index] = await fn(queue[index] as T);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, work));
  if (!isUndefined(failure)) throw failure.error;
  return results;
}
