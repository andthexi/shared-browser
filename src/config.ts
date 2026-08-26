export interface BrowserConfig {
  xpraPort: number;
  xpraBindHost: string;
  xpraDisplay: string;
  xpraHtml: 'on' | 'off' | 'auto';
  xpraSocketDir: string;
  profileDir: string;
  socketPath: string;
  screenWidth: number;
  screenHeight: number;
  screenDepth: number;
  pageLoadTimeoutMs: number;
  actionTimeoutMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`missing environment variable: ${name}`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, defaultValue: number, minimum: number): number {
  const raw = env[name] ?? String(defaultValue);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`invalid environment variable: ${name}`);
  return value;
}

function choice(env: NodeJS.ProcessEnv, name: string, defaultValue: BrowserConfig['xpraHtml']): BrowserConfig['xpraHtml'] {
  const value = env[name] ?? defaultValue;
  if (value !== 'on' && value !== 'off' && value !== 'auto') throw new Error(`invalid environment variable: ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const config: BrowserConfig = {
    xpraPort: integer(env, 'XPRA_PORT', 14500, 1024),
    xpraBindHost: env.XPRA_BIND_HOST ?? '127.0.0.1',
    xpraDisplay: env.XPRA_DISPLAY ?? ':99',
    xpraHtml: choice(env, 'XPRA_HTML', 'on'),
    xpraSocketDir: env.XPRA_SOCKET_DIR ?? './runtime/xpra',
    profileDir: required(env, 'BROWSER_PROFILE_DIR'),
    socketPath: required(env, 'BROWSER_CONTROL_SOCKET'),
    screenWidth: integer(env, 'SCREEN_WIDTH', 1280, 320),
    screenHeight: integer(env, 'SCREEN_HEIGHT', 900, 240),
    screenDepth: integer(env, 'SCREEN_DEPTH', 24, 24),
    pageLoadTimeoutMs: integer(env, 'PAGE_LOAD_TIMEOUT_MS', 30_000, 1),
    actionTimeoutMs: integer(env, 'ACTION_TIMEOUT_MS', 10_000, 1),
  };
  displayNumber(config.xpraDisplay);
  return config;
}

export function displayNumber(display: string): string {
  const match = /^:(\d+)$/.exec(display);
  if (match === null) throw new Error('XPRA_DISPLAY must use the form :<number>');
  const number = match[1];
  if (number === undefined) throw new Error('XPRA_DISPLAY must use the form :<number>');
  return number;
}
