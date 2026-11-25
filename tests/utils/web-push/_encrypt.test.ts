import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeBase64URL, encodeBase64URL } from '../../../src/utils/index.ts';
import { encryptPush } from '../../../src/utils/web-push/_encrypt.ts';

const keys = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

const sender = {
  publicKey:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
};

describe('encryptPush', () => {
  it('matches the RFC 8291 Appendix A body', async () => {
    const plaintext = decodeBase64URL('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24');
    const body = await encryptPush(
      plaintext,
      keys,
      sender,
      decodeBase64URL('DGv6ra1nlYgDCS1FRnbzlw'),
    );
    strictEqual(
      encodeBase64URL(body),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('frames a fresh salt and sender key per message', async () => {
    const plaintext = new TextEncoder().encode('hi');
    const [a, b] = await Promise.all([encryptPush(plaintext, keys), encryptPush(plaintext, keys)]);
    strictEqual(a.length, 86 + plaintext.length + 17);
    strictEqual(new DataView(a.buffer).getUint32(16), 4096);
    strictEqual(a[20], 65);
    strictEqual(a[21], 4);
    strictEqual(encodeBase64URL(a.subarray(0, 16)) === encodeBase64URL(b.subarray(0, 16)), false);
    strictEqual(encodeBase64URL(a.subarray(21, 86)) === encodeBase64URL(b.subarray(21, 86)), false);
  });

  it('takes a 3993-byte plaintext and rejects a longer one', async () => {
    strictEqual((await encryptPush(new Uint8Array(3993), keys)).length, 4096);
    await rejects(encryptPush(new Uint8Array(3994), keys), /3994 bytes/);
  });
});
