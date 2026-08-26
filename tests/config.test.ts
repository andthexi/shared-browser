import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('configuration', () => {
  it('loads Xpra values and defaults optional values', () => {
    expect(loadConfig({
      XPRA_PORT: '14507',
      XPRA_BIND_HOST: '127.0.0.1',
      XPRA_DISPLAY: ':107',
      XPRA_HTML: 'on',
      XPRA_SOCKET_DIR: './runtime/xpra',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      SCREEN_WIDTH: '1440',
      SCREEN_HEIGHT: '900',
      SCREEN_DEPTH: '24',
      PAGE_LOAD_TIMEOUT_MS: '45000',
      ACTION_TIMEOUT_MS: '12000',
    })).toEqual({
      xpraPort: 14507,
      xpraBindHost: '127.0.0.1',
      xpraDisplay: ':107',
      xpraHtml: 'on',
      xpraSocketDir: './runtime/xpra',
      profileDir: './runtime/profile',
      socketPath: './runtime/control.sock',
      screenWidth: 1440,
      screenHeight: 900,
      screenDepth: 24,
      pageLoadTimeoutMs: 45000,
      actionTimeoutMs: 12000,
    });
  });

  it('uses documented Xpra defaults', () => {
    expect(loadConfig({
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    })).toMatchObject({
      xpraPort: 14500,
      xpraBindHost: '127.0.0.1',
      xpraDisplay: ':99',
      xpraHtml: 'on',
      xpraSocketDir: './runtime/xpra',
      screenWidth: 1920,
      screenHeight: 1080,
      screenDepth: 24,
      pageLoadTimeoutMs: 30_000,
      actionTimeoutMs: 10_000,
    });
  });

  it('rejects missing and invalid values', () => {
    expect(() => loadConfig({ BROWSER_CONTROL_SOCKET: './runtime/control.sock' })).toThrow('BROWSER_PROFILE_DIR');
    expect(() => loadConfig({
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      XPRA_HTML: 'invalid',
    })).toThrow('XPRA_HTML');
    expect(() => loadConfig({
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      XPRA_DISPLAY: '99',
    })).toThrow('XPRA_DISPLAY');
  });
});
