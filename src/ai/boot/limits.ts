import { hook } from 'ohnejs';

import { assertTokenStore } from '../turns/limits.ts';

// Once the app's boot files have registered their stores, so a custom `api.rateLimitStore` is judged.
hook('server:ready', assertTokenStore);
