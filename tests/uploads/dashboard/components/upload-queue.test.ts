import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createUploadQueue,
  type UploadOutcome,
  type UploadSender,
  type UploadSendHooks,
  type UploadTask,
} from '../../../../src/uploads/dashboard/components/upload-queue-state.ts';

interface InFlight {
  name: string;
  hooks: UploadSendHooks;
  resolve(outcome: UploadOutcome): void;
  reject(error: unknown): void;
}

interface Stub {
  send: UploadSender;
  inFlight: InFlight[];
  started: string[];
  peak: number;
}

function stub(): Stub {
  const state: Stub = {
    inFlight: [],
    started: [],
    peak: 0,
    send: (task, _file, hooks) =>
      new Promise((resolve, reject) => {
        const leave = (): void => {
          const index = state.inFlight.indexOf(entry);
          if (index !== -1) state.inFlight.splice(index, 1);
        };
        const entry: InFlight = {
          name: task.name,
          hooks,
          resolve: (outcome) => {
            leave();
            resolve(outcome);
          },
          reject: (error) => {
            leave();
            reject(error);
          },
        };
        hooks.signal.addEventListener('abort', () => entry.reject(hooks.signal.reason));
        state.inFlight.push(entry);
        state.started.push(task.name);
        state.peak = Math.max(state.peak, state.inFlight.length);
      }),
  };
  return state;
}

function file(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name);
}

function completed(name: string, directory = ''): UploadOutcome {
  return { ok: true, UUID: `uuid-${name}`, name, directory };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

function drain(transport: Stub): void {
  while (transport.inFlight.length > 0) {
    const [entry] = transport.inFlight;
    entry.resolve(completed(entry.name));
  }
}

const names = (tasks: readonly UploadTask[]): string[] => tasks.map((task) => task.name);

const statuses = (tasks: readonly UploadTask[]): string[] => tasks.map((task) => task.status);

describe('createUploadQueue', () => {
  it('runs at most five at once, in the order given', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const items = Array.from({ length: 8 }, (_, i) => ({ file: file(`${i}.png`), directory: '' }));
    const batch = queue.enqueue(items);

    strictEqual(transport.inFlight.length, 5);
    deepStrictEqual(transport.started, ['0.png', '1.png', '2.png', '3.png', '4.png']);
    deepStrictEqual(statuses(queue.tasks()), [
      ...Array<string>(5).fill('uploading'),
      ...Array<string>(3).fill('pending'),
    ]);

    transport.inFlight[0].resolve(completed('0.png'));
    await settle();
    strictEqual(transport.inFlight.length, 5);
    strictEqual(transport.started[5], '5.png');

    while (transport.inFlight.length > 0) {
      transport.inFlight[0].resolve(completed(transport.inFlight[0].name));
      await settle();
    }
    strictEqual(transport.peak, 5);
    deepStrictEqual(statuses(await batch), Array<string>(8).fill('completed'));
    deepStrictEqual(
      names(queue.tasks()),
      items.map(({ file: f }) => f.name),
    );
  });

  it('lists a newer batch first but starts it after the older one', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    void queue.enqueue([{ file: file('a.png'), directory: '' }]);
    void queue.enqueue([{ file: file('b.png'), directory: '' }]);

    deepStrictEqual(names(queue.tasks()), ['b.png', 'a.png']);
    deepStrictEqual(transport.started, ['a.png']);

    transport.inFlight[0].resolve(completed('a.png'));
    await settle();
    deepStrictEqual(transport.started, ['a.png', 'b.png']);
  });

  it('aborting an upload marks it aborted and frees its slot', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 2 });
    const batch = queue.enqueue(
      ['a', 'b', 'c'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );

    transport.inFlight[0].hooks.onProgress(512, 1024);
    strictEqual(queue.tasks()[0].progress, 0.5);

    queue.tasks()[0].abort();
    strictEqual(queue.tasks()[0].status, 'aborted');
    strictEqual(queue.tasks()[0].progress, 0);
    await settle();
    deepStrictEqual(transport.started, ['a.png', 'b.png', 'c.png']);
    strictEqual(transport.inFlight.length, 2);

    queue.tasks()[0].abort();
    strictEqual(queue.tasks()[0].status, 'aborted');

    drain(transport);
    deepStrictEqual(statuses(await batch), ['aborted', 'completed', 'completed']);
  });

  it('aborting a pending upload settles it without sending', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    const batch = queue.enqueue(['a', 'b'].map((n) => ({ file: file(`${n}.png`), directory: '' })));

    queue.tasks()[1].abort();
    strictEqual(queue.tasks()[1].status, 'aborted');

    transport.inFlight[0].resolve(completed('a.png'));
    deepStrictEqual(statuses(await batch), ['completed', 'aborted']);
    deepStrictEqual(transport.started, ['a.png']);
  });

  it('a failure settles its own task and the rest run on', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    const batch = queue.enqueue(
      ['a', 'b', 'c'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );

    transport.inFlight[0].resolve({ ok: false, error: 'File type `image/png` is not allowed' });
    await settle();
    transport.inFlight[0].reject(new TypeError('Network request failed'));
    await settle();
    transport.inFlight[0].resolve(completed('c.png'));

    const tasks = await batch;
    deepStrictEqual(statuses(tasks), ['failed', 'failed', 'completed']);
    strictEqual(tasks[0].error, 'File type `image/png` is not allowed');
    strictEqual(tasks[0].progress, 1);
    strictEqual(tasks[1].error, 'Network request failed');
  });

  it('a completed task takes the name, folder, and UUID the server answered', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue([{ file: file('Sunset.JPG'), directory: 'Photos' }]);

    deepStrictEqual(transport.started, ['Sunset.JPG']);
    transport.inFlight[0].resolve({
      ok: true,
      UUID: 'u1',
      name: 'sunset-2.jpg',
      directory: 'photos',
    });

    const [task] = await batch;
    strictEqual(task.status, 'completed');
    strictEqual(task.name, 'sunset-2.jpg');
    strictEqual(task.directory, 'photos');
    strictEqual(task.UUID, 'u1');
    strictEqual(task.progress, 1);
  });

  it('reports every settled task once, aborts included', async () => {
    const transport = stub();
    const settled: string[] = [];
    const queue = createUploadQueue(transport.send, {
      concurrency: 3,
      onSettle: (task) => settled.push(`${task.name}:${task.status}`),
    });
    const batch = queue.enqueue(
      ['a', 'b', 'c'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );

    const [a, b] = transport.inFlight;
    a.resolve(completed('a.png'));
    b.resolve({ ok: false, error: 'nope' });
    queue.tasks()[2].abort();
    await batch;
    deepStrictEqual(settled.sort(), ['a.png:completed', 'b.png:failed', 'c.png:aborted']);
  });

  it('hides a task from the list', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue(['a', 'b'].map((n) => ({ file: file(`${n}.png`), directory: '' })));

    queue.hide(queue.tasks()[0].id);
    deepStrictEqual(names(queue.tasks()), ['b.png']);

    drain(transport);
    deepStrictEqual(names(await batch), ['b.png']);
  });

  it('measures the speed from progress deltas over a rolling window', async () => {
    const transport = stub();
    let clock = 0;
    const queue = createUploadQueue(transport.send, { now: () => clock, speedWindow: 3000 });
    void queue.enqueue([{ file: file('a.bin', 8000), directory: '' }]);
    const { hooks } = transport.inFlight[0];

    hooks.onProgress(1000, 8000);
    strictEqual(queue.speed(), null);

    clock = 1000;
    hooks.onProgress(3000, 8000);
    strictEqual(queue.speed(), 2000);

    clock = 2000;
    hooks.onProgress(7000, 8000);
    strictEqual(queue.speed(), 3000);

    clock = 6000;
    hooks.onProgress(7500, 8000);
    strictEqual(queue.speed(), 3000);

    clock = 7000;
    hooks.onProgress(8000, 8000);
    strictEqual(queue.speed(), 500);
    strictEqual(queue.tasks()[0].progress, 1);
  });

  it('resolves an empty batch at once', async () => {
    const queue = createUploadQueue(stub().send);
    deepStrictEqual(await queue.enqueue([]), []);
  });
});
