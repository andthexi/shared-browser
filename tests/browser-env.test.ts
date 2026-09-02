import { describe, expect, it } from 'vitest';

import { nativeBrowserEnv } from '../src/browser.js';

describe('local browser environment', () => {
  it('omits DISPLAY and XAUTHORITY', () => {
    expect(nativeBrowserEnv({ DISPLAY: ':99', XAUTHORITY: '/tmp/xauth', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });
});
