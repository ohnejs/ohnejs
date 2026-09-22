import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../../../src/uploads/config.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { signImageVariant } from '../../../src/uploads/images/sign.ts';
import {
  signUploadLink,
  uploadSecrets,
  verifyUploadLink,
} from '../../../src/uploads/uploads/sign.ts';

const PATH = 'photos/sunset.jpg';
const EXPIRES = 1_700_000_000_000;

describe('signUploadLink', () => {
  it('matches the protocol vectors', () => {
    strictEqual(
      signUploadLink(PATH, EXPIRES, 'secret'),
      'lbshLgROalNk_URHWIraK7YDalfVmPq9WlenM8B9Ytg',
    );
    strictEqual(
      signUploadLink(PATH, EXPIRES, 'another'),
      'HpKMWLI2BVtg4rQ7mFtTs81N2jZ-Mu2aAUWguLdV_ro',
    );
  });

  it('is the image variant signature over the expiry token alone', () => {
    strictEqual(
      signUploadLink(PATH, EXPIRES, 'secret'),
      signImageVariant(`e_${EXPIRES}`, PATH, 'secret'),
    );
  });
});

describe('verifyUploadLink', () => {
  it('accepts any listed secret and nothing else', () => {
    const signature = signUploadLink(PATH, EXPIRES, 'old');
    strictEqual(verifyUploadLink(signature, PATH, EXPIRES, ['new', 'old']), true);
    strictEqual(verifyUploadLink(signature, PATH, EXPIRES, ['new']), false);
    strictEqual(verifyUploadLink(signature, PATH, EXPIRES + 1, ['old']), false);
    strictEqual(verifyUploadLink(signature, 'photos/dawn.jpg', EXPIRES, ['old']), false);
    strictEqual(verifyUploadLink('', PATH, EXPIRES, ['old']), false);
    strictEqual(verifyUploadLink(signature, PATH, EXPIRES, []), false);
  });
});

describe('uploadSecrets', () => {
  it('splits the env var and drops empty entries', () => {
    useEnv().set('UPLOADS_SECRET', ' new , old,, ');
    deepStrictEqual(uploadSecrets(), ['new', 'old']);
    useEnv().set('UPLOADS_SECRET', undefined);
    deepStrictEqual(uploadSecrets(), []);
    useEnv().unset('UPLOADS_SECRET');
    deepStrictEqual(uploadSecrets(), []);
  });
});
