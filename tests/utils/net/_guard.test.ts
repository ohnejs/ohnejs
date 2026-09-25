import { ok, strictEqual } from 'node:assert';
import { networkInterfaces } from 'node:os';
import { describe, it } from 'node:test';

import { createAdmit } from '../../../src/utils/net/_guard.ts';
import { isPublicIP } from '../../../src/utils/net/index.ts';

/**
 * The address beside `address` in its network: the same address with its lowest bit flipped.
 */
function neighborOf(address: string): string {
  const radix = address.includes(':') ? 16 : 10;
  const cut = address.lastIndexOf(radix === 16 ? ':' : '.') + 1;
  const last = Number.parseInt(address.slice(cut) || '0', radix);
  return address.slice(0, cut) + (last ^ 1).toString(radix);
}

const onLink = Object.values(networkInterfaces())
  .flatMap((list = []) => list)
  .find(
    ({ internal, address, family, cidr }) =>
      !internal &&
      isPublicIP(address) &&
      Number(cidr?.split('/')[1]) < (family === 'IPv6' ? 128 : 32),
  );

describe('createAdmit', () => {
  it(
    "refuses a public neighbor on one of the host's own networks",
    { skip: !onLink && 'no public interface network with room for a neighbor' },
    () => {
      const neighbor = neighborOf(onLink!.address);
      ok(isPublicIP(neighbor), neighbor);
      strictEqual(createAdmit([])(80)(neighbor), false);
      strictEqual(createAdmit([onLink!.cidr!])(80)(neighbor), true);
    },
  );

  it('checks a long DNS answer against one read of the host networks', () => {
    const four = Array.from({ length: 4090 }, (_, i) => `93.184.${(i >> 8) & 255}.${i & 255}`);
    const six = Array.from({ length: 2330 }, (_, i) => `2606:2800::${i.toString(16)}`);
    const admitted = createAdmit([])(443);
    const started = performance.now();
    ok([...four, ...six].every(admitted));
    const elapsed = performance.now() - started;
    ok(elapsed < 250, `${elapsed.toFixed(0)} ms`);
  });
});
