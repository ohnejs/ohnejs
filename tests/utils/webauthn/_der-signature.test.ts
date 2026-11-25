import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { derToP1363 } from '../../../src/utils/webauthn/_der-signature.ts';

const convert = (hex: string) => derToP1363(Uint8Array.fromHex(hex), 4).toHex();

describe('derToP1363', () => {
  it('left-pads short integers and drops the sign byte', () => {
    strictEqual(convert('3007020101020200ff'), '00000001000000ff');
    strictEqual(convert('300a02050080000001020101'), '8000000100000001');
  });

  it('converts a spec ES256 signature to 64 bytes', () => {
    const der =
      '3046022100f50a4e2e4409249c4a853ba361282f09841df4dd4547a13a87780218deffcd380221008480ac0f0b93538174f575bf11a1dd5d78c6e486013f937295ea13653e331e87';
    strictEqual(
      derToP1363(Uint8Array.fromHex(der), 32).toHex(),
      'f50a4e2e4409249c4a853ba361282f09841df4dd4547a13a87780218deffcd388480ac0f0b93538174f575bf11a1dd5d78c6e486013f937295ea13653e331e87',
    );
  });

  it('rejects malformed DER', () => {
    for (const hex of [
      '',
      '3106020101020101',
      '3007020101020101',
      '300602010102010100',
      '3006020101030101',
      '3005020002010101',
      '3006020181020101',
      '300702020001020101',
      '300902050100000001020101',
    ]) {
      throws(() => convert(hex), /Invalid DER signature/, hex);
    }
  });
});
