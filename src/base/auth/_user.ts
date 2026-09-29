import { queryMetadata } from 'ohnejs';

/**
 * The readable `Users` fields, for a read that names `password` and must still carry the rest.
 * `toUser` projects whatever the account layout places, so every readable field rides along.
 */
export function userColumns(): string[] {
  return Object.entries(queryMetadata('Users').fields)
    .filter(([, field]) => field.readable !== false)
    .map(([name]) => name);
}
