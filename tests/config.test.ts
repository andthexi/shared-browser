import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

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
      profileDir: resolve('.', 'runtime/profile'),
      socketPath: resolve('.', 'runtime/control.sock'),
      logFile: resolve('.', 'runtime/shared-browser.log'),
      pidFile: resolve('.', 'runtime/shared-browser.pid'),
      screenWidth: 1440,
      screenHeight: 900,
      screenDepth: 24,
      pageLoadTimeoutMs: 45000,
      actionTimeoutMs: 12000,
      bringTabsToFront: true,
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
      logFile: resolve('.', 'runtime/shared-browser.log'),
      pidFile: resolve('.', 'runtime/shared-browser.pid'),
      screenDepth: 24,
      pageLoadTimeoutMs: 30_000,
      actionTimeoutMs: 10_000,
      bringTabsToFront: true,
    });
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({
      VNC_PORT: 'bad',
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
    expect(() => loadConfig({
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      BRING_TABS_TO_FRONT: 'maybe',
    })).toThrow('BRING_TABS_TO_FRONT');
  });

  it('allows disabling tab activation', () => {
    expect(loadConfig({
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
      BRING_TABS_TO_FRONT: 'false',
    }).bringTabsToFront).toBe(false);
  });

  it('defaults VNC_PORT when omitted', () => {
    expect(loadConfig({
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    }).vncPort).toBe(5900);
  });

  it('does not require a display in local mode', () => {
    expect(loadConfig({
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    }, { localMode: true }).display).toBeNull();
  });

  it('anchors relative runtime paths to the configured root', () => {
    const config = loadConfig({
      DISPLAY: ':99',
      BROWSER_PROFILE_DIR: './runtime/profile',
      BROWSER_CONTROL_SOCKET: './runtime/control.sock',
    }, { rootDir: '/repo' });
    expect(config.profileDir).toBe('/repo/runtime/profile');
    expect(config.socketPath).toBe('/repo/runtime/control.sock');
    expect(config.logFile).toBe('/repo/runtime/shared-browser.log');
    expect(config.pidFile).toBe('/repo/runtime/shared-browser.pid');
  });
});
