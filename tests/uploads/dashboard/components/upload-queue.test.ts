import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createUploadQueue,
  type UploadItem,
  type UploadOutcome,
  type UploadSender,
  type UploadSendHooks,
  type UploadTask,
} from '../../../../src/uploads/dashboard/components/upload-queue-state.ts';

interface InFlight {
  name: string;
  task: UploadTask;
  item: UploadItem;
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
    send: (task, item, hooks) =>
      new Promise((resolve, reject) => {
        const leave = (): void => {
          const index = state.inFlight.indexOf(entry);
          if (index !== -1) state.inFlight.splice(index, 1);
        };
        const entry: InFlight = {
          name: task.name,
          task,
          item,
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
  return { ok: true, UUID: `uuid-${name}`, name, directory, size: 1024 };
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

  it('a completed task takes the name, folder, size, and UUID the server answered', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue([{ file: file('Sunset.JPG'), directory: 'Photos' }]);

    deepStrictEqual(transport.started, ['Sunset.JPG']);
    transport.inFlight[0].resolve({
      ok: true,
      UUID: 'u1',
      name: 'sunset-2.jpg',
      directory: 'photos',
      size: 1000,
    });

    const [task] = await batch;
    strictEqual(task.status, 'completed');
    strictEqual(task.name, 'sunset-2.jpg');
    strictEqual(task.directory, 'photos');
    strictEqual(task.size, 1000);
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

  it('hiding a pending task takes it out of the queue, so it never runs', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    const batch = queue.enqueue(
      ['thrall', 'jaina'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );

    queue.hide(queue.tasks()[1].id);
    transport.inFlight[0].resolve(completed('thrall.png'));
    await settle();
    deepStrictEqual(transport.started, ['thrall.png']);
    deepStrictEqual(names(await batch), ['thrall.png']);
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

  it('drops the speed while a task is stalled, and measures afresh once bytes flow again', () => {
    const transport = stub();
    let clock = 0;
    const queue = createUploadQueue(transport.send, { now: () => clock, speedWindow: 3000 });
    void queue.enqueue([{ file: file('a.bin', 8000), directory: '' }]);
    const { hooks } = transport.inFlight[0];

    hooks.onProgress(1000, 8000);
    clock = 1000;
    hooks.onProgress(3000, 8000);
    strictEqual(queue.speed(), 2000);

    hooks.onStall(true);
    strictEqual(queue.speed(), null);

    clock = 2000;
    hooks.onStall(false);
    hooks.onProgress(4000, 8000);
    strictEqual(queue.speed(), null);

    clock = 2500;
    hooks.onProgress(5000, 8000);
    strictEqual(queue.speed(), 2000);
  });

  it('clears the list and the speed, stopping every pending and running task unreported', async () => {
    const transport = stub();
    let clock = 0;
    const settled: string[] = [];
    const queue = createUploadQueue(transport.send, {
      concurrency: 1,
      now: () => clock,
      onSettle: (task) => settled.push(`${task.name}:${task.status}`),
    });
    const failing = queue.enqueue([{ file: file('garrosh.png'), directory: '' }]);
    transport.inFlight[0].resolve({ ok: false, error: 'nope' });
    const [failed] = await failing;
    const batch = queue.enqueue(
      ['saurfang', 'nazgrel'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );
    const { hooks } = transport.inFlight[0];
    hooks.onProgress(0, 1024);
    clock = 1000;
    hooks.onProgress(512, 1024);
    strictEqual(queue.speed(), 512);

    queue.clear();
    deepStrictEqual(queue.tasks(), []);
    strictEqual(queue.speed(), null);
    strictEqual(hooks.signal.aborted, true);
    deepStrictEqual(await batch, []);
    deepStrictEqual(settled, ['garrosh.png:failed']);
    deepStrictEqual(transport.started, ['garrosh.png', 'saurfang.png']);
    strictEqual(await queue.retry(failed.id), undefined);
  });

  it('clearing stops a hidden task too', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    const batch = queue.enqueue(
      ['thrall', 'jaina', 'arthas'].map((n) => ({ file: file(`${n}.png`), directory: '' })),
    );
    const { signal } = transport.inFlight[0].hooks;
    const [thrall, jaina] = queue.tasks();

    queue.hide(thrall.id);
    queue.hide(jaina.id);
    queue.clear();
    strictEqual(signal.aborted, true);
    await settle();
    deepStrictEqual(transport.started, ['thrall.png']);
    deepStrictEqual(await batch, []);
  });

  it('resolves an empty batch at once', async () => {
    const queue = createUploadQueue(stub().send);
    deepStrictEqual(await queue.enqueue([]), []);
  });

  it('names a URL task after its path, else its host, with no size and no URL', () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const axe = 'https://cdn.azeroth.example/thrall/Doom%20Hammer.png;v=2?token=frostmourne#top';
    void queue.enqueue([
      { url: axe, directory: 'orgrimmar' },
      { url: 'http://cdn.azeroth.example:8080/', directory: '' },
    ]);

    const [named, bare] = queue.tasks();
    deepStrictEqual(
      [named.name, named.size, named.host],
      ['Doom Hammer.png', null, 'cdn.azeroth.example'],
    );
    deepStrictEqual(
      [bare.name, bare.size, bare.host],
      ['cdn.azeroth.example:8080', null, 'cdn.azeroth.example:8080'],
    );
    strictEqual(JSON.stringify(queue.tasks()).includes('frostmourne'), false);
    deepStrictEqual(transport.inFlight[0].item, { url: axe, directory: 'orgrimmar' });
  });

  it('a file task keeps no host', () => {
    const queue = createUploadQueue(stub().send);
    void queue.enqueue([{ file: file('jaina.png', 2048), directory: '' }]);

    const [task] = queue.tasks();
    deepStrictEqual([task.name, task.size, task.host], ['jaina.png', 2048, undefined]);
  });

  it('a completed URL task takes the name and size the server stored', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue([{ url: 'https://cdn.azeroth.example/sylvanas', directory: '' }]);

    strictEqual(queue.tasks()[0].status, 'uploading');
    transport.inFlight[0].resolve({
      ok: true,
      UUID: 'u1',
      name: 'sylvanas.webp',
      directory: '',
      size: 4096,
    });

    const [task] = await batch;
    deepStrictEqual(
      [task.status, task.name, task.size, task.progress],
      ['completed', 'sylvanas.webp', 4096, 1],
    );
  });

  it('aborting a URL task aborts its send and frees its slot', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send, { concurrency: 1 });
    const batch = queue.enqueue([
      { url: 'https://cdn.azeroth.example/arthas.png', directory: '' },
      { file: file('uther.png'), directory: '' },
    ]);
    const { signal } = transport.inFlight[0].hooks;

    queue.tasks()[0].abort();
    strictEqual(signal.aborted, true);
    await settle();
    deepStrictEqual(transport.started, ['arthas.png', 'uther.png']);

    drain(transport);
    deepStrictEqual(statuses(await batch), ['aborted', 'completed']);
  });

  it('runs at most two URL tasks at once, and files pass a waiting one', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const heroes = ['thrall', 'jaina', 'arthas', 'sylvanas'];
    const batch = queue.enqueue([
      ...heroes.map((hero) => ({ url: `https://cdn.azeroth.example/${hero}.png`, directory: '' })),
      { file: file('uther.png'), directory: '' },
    ]);

    deepStrictEqual(transport.started, ['thrall.png', 'jaina.png', 'uther.png']);
    deepStrictEqual(statuses(queue.tasks()), [
      'uploading',
      'uploading',
      'pending',
      'pending',
      'uploading',
    ]);

    transport.inFlight[0].resolve(completed('thrall.png'));
    await settle();
    deepStrictEqual(transport.started.slice(3), ['arthas.png']);

    queue.tasks()[1].abort();
    await settle();
    deepStrictEqual(transport.started.slice(3), ['arthas.png', 'sylvanas.png']);

    while (transport.inFlight.length > 0) {
      transport.inFlight[0].resolve(completed(transport.inFlight[0].name));
      await settle();
    }
    deepStrictEqual(statuses(await batch), [
      'completed',
      'aborted',
      'completed',
      'completed',
      'completed',
    ]);
  });

  it('fails a URL task with the reason the sender answered', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue([
      { url: 'https://cdn.azeroth.example/illidan.png', directory: '' },
    ]);

    transport.inFlight[0].resolve({ ok: false, error: 'The URL could not be reached' });

    const [task] = await batch;
    deepStrictEqual(
      [task.status, task.error, task.size],
      ['failed', 'The URL could not be reached', null],
    );
  });

  it('retries a failed task with the same file and the session it kept', async () => {
    const transport = stub();
    const settled: string[] = [];
    const queue = createUploadQueue(transport.send, {
      onSettle: (task) => settled.push(task.status),
    });
    const doomhammer = file('doomhammer.bin', 8000);
    const batch = queue.enqueue([{ file: doomhammer, directory: 'orgrimmar' }]);
    const { hooks } = transport.inFlight[0];
    hooks.onSession('session-1');
    hooks.onProgress(4000, 8000);
    transport.inFlight[0].reject(new TypeError('Network request failed'));
    const [failed] = await batch;
    deepStrictEqual([failed.status, failed.session], ['failed', 'session-1']);

    const retried = queue.retry(failed.id);
    const [again] = transport.inFlight;
    strictEqual(again.item.directory, 'orgrimmar');
    strictEqual('file' in again.item && again.item.file, doomhammer);
    deepStrictEqual([again.task.id, again.task.session], [failed.id, 'session-1']);
    deepStrictEqual(
      [queue.tasks()[0].status, queue.tasks()[0].progress, queue.tasks()[0].error],
      ['uploading', 0, undefined],
    );

    again.resolve(completed('doomhammer.bin', 'orgrimmar'));
    strictEqual((await retried)?.status, 'completed');
    deepStrictEqual(settled, ['failed', 'completed']);
    strictEqual(await queue.retry(failed.id), undefined);
  });

  it('retries nothing but a failed task', async () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    const batch = queue.enqueue([{ file: file('jaina.png'), directory: '' }]);
    const [task] = queue.tasks();

    strictEqual(await queue.retry(task.id), undefined);
    strictEqual(transport.started.length, 1);

    transport.inFlight[0].resolve({ ok: false, error: 'nope' });
    await batch;
    queue.hide(task.id);
    strictEqual(await queue.retry(task.id), undefined);
    strictEqual(transport.started.length, 1);
  });

  it('starts a file task with the session its item continues', () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    void queue.enqueue([{ file: file('arthas.png'), directory: '', session: 'session-9' }]);

    strictEqual(queue.tasks()[0].session, 'session-9');
    strictEqual(transport.inFlight[0].task.session, 'session-9');
  });

  it('marks a task stalled while its sender waits to send again', () => {
    const transport = stub();
    const queue = createUploadQueue(transport.send);
    void queue.enqueue([{ file: file('sylvanas.png'), directory: '' }]);
    const { hooks } = transport.inFlight[0];

    hooks.onStall(true);
    strictEqual(queue.tasks()[0].stalled, true);
    hooks.onStall(false);
    strictEqual(queue.tasks()[0].stalled, false);
  });

  it('settles an aborted task with its session, pending or running', async () => {
    const transport = stub();
    const settled: [string, string | undefined][] = [];
    const queue = createUploadQueue(transport.send, {
      concurrency: 1,
      onSettle: (task) => settled.push([task.name, task.session]),
    });
    const batch = queue.enqueue([
      { file: file('illidan.png'), directory: '' },
      { file: file('tyrande.png'), directory: '', session: 'session-2' },
    ]);
    transport.inFlight[0].hooks.onSession('session-1');

    queue.tasks()[1].abort();
    queue.tasks()[0].abort();
    await batch;
    deepStrictEqual(settled, [
      ['tyrande.png', 'session-2'],
      ['illidan.png', 'session-1'],
    ]);
    deepStrictEqual(transport.started, ['illidan.png']);
  });

  it("counts a fresh run's first progress, but not the offset a continued session resumes from", () => {
    const transport = stub();
    let clock = 0;
    const queue = createUploadQueue(transport.send, { now: () => clock, speedWindow: 3000 });
    void queue.enqueue([
      { file: file('a.bin', 8000), directory: '' },
      { file: file('b.bin', 8000), directory: '' },
      { file: file('c.bin', 8000), directory: '', session: 'session-3' },
    ]);
    const [first, whole, resumed] = transport.inFlight;

    first.hooks.onProgress(0, 8000);
    clock = 500;
    resumed.hooks.onProgress(5000, 8000);
    strictEqual(queue.tasks()[2].progress, 0.625);
    clock = 1000;
    whole.hooks.onProgress(8000, 8000);
    strictEqual(queue.speed(), 8000);
  });
});
