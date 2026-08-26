import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('configuration', () => {
  it('loads required values and defaults optional values', () => {
    expect(loadConfig({
      VNC_PORT: '5907',
      DISPLAY: ':107',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      SCREEN_WIDTH: '1440',
      SCREEN_HEIGHT: '900',
      SCREEN_DEPTH: '24',
      PAGE_LOAD_TIMEOUT_MS: '45000',
      ACTION_TIMEOUT_MS: '12000',
    })).toEqual({
      vncPort: 5907,
      display: ':107',
      profileDir: './runtime/profile',
      socketPath: './runtime/control.sock',
      screenWidth: 1440,
      screenHeight: 900,
      screenDepth: 24,
      pageLoadTimeoutMs: 45000,
      actionTimeoutMs: 12000,
    });
  });

  it('uses documented defaults', () => {
    expect(loadConfig({
      VNC_PORT: '5900',
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    })).toMatchObject({
      screenWidth: 1680,
      screenHeight: 945,
      screenDepth: 24,
      pageLoadTimeoutMs: 30_000,
      actionTimeoutMs: 10_000,
    });
  });

  it('rejects missing and invalid values', () => {
    expect(() => loadConfig({
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    })).toThrow('VNC_PORT');
    expect(() => loadConfig({
      VNC_PORT: '5900',
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      SCREEN_DEPTH: '17',
    })).toThrow('SCREEN_DEPTH');
  });
});
