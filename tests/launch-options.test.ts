import { describe, expect, it } from 'vitest';

import { chromiumLaunchArgs } from '../src/browser.js';

describe('Chromium launch options', () => {
  it('includes the automation-controlled blink override', () => {
    expect(chromiumLaunchArgs()).toContain('--disable-blink-features=AutomationControlled');
  });
});
