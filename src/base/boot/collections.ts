import { ohneError, useConfig } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

const COLLECTIONS = ['Users', 'Sessions'];

assertCollections();

/**
 * Refuses a `disable.collections` that drops a collection sign-in runs on, with an error block.
 * Every signed-in request reads each of them, so the layer cannot run without one.
 * It runs as the file loads, since a sync without the collection drops its empty table.
 */
function assertCollections(): void {
  const disabled = useConfig().disable.collections;
  const name = COLLECTIONS.find((collection) => disabled.includes(collection));
  if (isUndefined(name)) return;
  throw ohneError({
    title: `The \`ohnejs/base\` layer needs \`${name}\``,
    body: [
      'You list it in `disable.collections`, but sign-in keeps its users and sessions there.',
      '',
      `Remove \`${name}\` from \`disable.collections\`.`,
    ],
  });
}
