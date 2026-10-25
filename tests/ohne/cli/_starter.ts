import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { TarSpec } from '../../utils/tar/_tar.ts';

import { pax, tar } from '../../utils/tar/_tar.ts';

/**
 * The starter's `pnpm-workspace.yaml`, with the age-gate exclusions a scaffold drops.
 */
export const WORKSPACE = `packages:
  - apps/*

catalog:
  ohnejs: 0.4.0

minimumReleaseAgeExclude:
  - ohnejs
  - '@ohnejs/*'
`;

/**
 * Files a scaffold writes byte for byte, keyed by their path in the project.
 */
export const KEPT: Record<string, string | Uint8Array> = {
  '.gitignore': 'node_modules/\n',
  'apps/backend/package.json': '{ "name": "backend", "private": true }\n',
  'apps/web/public/logo.bin': new Uint8Array([0, 255, 10, 13, 0]),
};

/**
 * Writes a gzipped starter archive shaped like GitHub's into `dir` and returns its path.
 * `extra` entries are appended as given, top folder included.
 */
export function starterTarball(dir: string, ...extra: TarSpec[]): string {
  const top = 'nuxt-starter-ohne-v0.4.0';
  const path = join(dir, 'starter.tar.gz');
  const bytes = tar(
    pax({ comment: '0a1b2c' }, 'g'),
    { name: `${top}/`, type: '5' },
    { name: `${top}/package.json`, data: '{\n  "name": "nuxt-starter",\n  "private": true\n}\n' },
    { name: `${top}/pnpm-workspace.yaml`, data: WORKSPACE },
    { name: `${top}/apps/`, type: '5' },
    { name: `${top}/apps/web/content/`, type: '5' },
    ...Object.entries(KEPT).map(([name, data]) => ({ name: `${top}/${name}`, data })),
    ...extra,
  );
  writeFileSync(path, gzipSync(bytes));
  return path;
}
