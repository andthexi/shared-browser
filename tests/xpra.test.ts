import { describe, expect, it } from 'vitest';

import { xpraArguments } from '../src/xpra.js';

describe('Xpra command construction', () => {
  it('binds to localhost, disables mDNS, and enables HTML5', () => {
    expect(xpraArguments({
      xpraPort: 14500,
      xpraBindHost: '127.0.0.1',
      xpraDisplay: ':99',
      xpraHtml: 'on',
      xpraSocketDir: './runtime/xpra',
      screenWidth: 1280,
      screenHeight: 900,
      screenDepth: 24,
    })).toEqual([
      'start-desktop', ':99',
      '--daemon=no',
      '--bind-tcp=127.0.0.1:14500',
      '--html=on',
      '--mdns=no',
      '--socket-dir=./runtime/xpra',
      '--resize-display=1280x900',
      '--pixel-depth=24',
    ]);
  });
});
