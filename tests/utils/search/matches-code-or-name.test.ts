import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { matchesCodeOrName } from '../../../src/utils/index.ts';

describe('matchesCodeOrName', () => {
  it('finds the exact code in any case', () => {
    strictEqual(matchesCodeOrName('DE', 'Deutschland', 'de'), true);
    strictEqual(matchesCodeOrName('EUR', 'Euro', 'eur'), true);
  });

  it('finds a word start of the name, ignoring case and accents', () => {
    strictEqual(matchesCodeOrName('DE', 'Deutschland', 'DEUT'), true);
    strictEqual(matchesCodeOrName('CI', "Côte d'Ivoire", 'cote'), true);
    strictEqual(matchesCodeOrName('BA', 'Bosna i Hercegovina', 'herc'), true);
  });

  it('finds nothing from the middle of the name or a partial code', () => {
    strictEqual(matchesCodeOrName('DE', 'Deutschland', 'land'), false);
    strictEqual(matchesCodeOrName('EUR', 'Euro', 'ur'), false);
  });
});
