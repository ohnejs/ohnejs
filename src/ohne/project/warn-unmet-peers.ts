import { codeSpan } from '../../utils/ansi/index.ts';
import {
  admitsVersion,
  isPrerelease,
  isUndefined,
  joinPath,
  parsePeerRange,
  relativePath,
} from '../../utils/index.ts';
import { version } from '../meta/version.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { resolveOhnePackages } from './resolve-ohne-layers.ts';

/**
 * Warns for each installed package whose `ohnejs` peer range leaves out the running version.
 * A range in no shape `parsePeerRange` reads is left to the package manager, so nothing is guessed.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * `running` is the ohne version to judge, this one unless a test passes another.
 */
export async function warnUnmetPeers(
  from: string = process.cwd(),
  running: string = version,
): Promise<void> {
  for (const { name, dir, peer } of await resolveOhnePackages(from)) {
    if (isUndefined(peer)) continue;
    const range = parsePeerRange(peer);
    if (isUndefined(range) || admitsVersion(range, running)) continue;
    const span = range.exact
      ? `only ohne ${codeSpan(range.floor)}`
      : `ohne ${codeSpan(`>=${range.floor} <${range.ceiling}`)}`;
    const rule =
      !range.exact && isPrerelease(running)
        ? ', and a prerelease only when it names one of that version'
        : '';
    usePrinter().warnBlock({
      title: `${codeSpan(name)} does not support ohne \`${running}\``,
      body: [
        `It supports ${span}${rule}.`,
        '',
        `Install a release of ${codeSpan(name)} that supports ohne \`${running}\`, or an ohne it supports.`,
      ],
      path: relativePath(process.cwd(), joinPath(dir, 'package.json')),
    });
  }
}
