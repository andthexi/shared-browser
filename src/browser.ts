import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

import type { BrowserConfig } from './config.js';
import { displayNumber } from './config.js';
import { classifyCookieConsentCandidate, withCookieConsentRetry } from './cookie-consent.js';
import { classifyClickSafety } from './safety.js';
import { ControlServer, probeTcpPort, type ControlRequest, type ControlResponse } from './socket.js';
import { OpportunityTabs, type TabPage } from './tabs.js';
import { RuntimeLogger } from './logger.js';
import { removePidFile, writePidFile } from './process-identity.js';

declare global {
  interface Window { __sharedBrowserAgentAction?: boolean; }
}

interface ManagedProcess {
  child: ChildProcess;
  name: string;
}

interface Target {
  label?: string;
  placeholder?: string;
  role?: string;
  name?: string;
  css?: string;
  index?: number;
}

const submitGuard = `(() => {
  const blocked = () => Boolean(window.__sharedBrowserAgentAction);
  document.addEventListener('submit', event => {
    if (blocked()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function(...args) {
    if (blocked()) return;
    return originalSubmit.apply(this, args);
  };
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.requestSubmit = function(...args) {
    if (blocked()) return;
    return originalRequestSubmit.apply(this, args);
  };
})();`;

type PageMetadata = {
  url: string;
  title: string;
  text: string;
  elements: Array<Record<string, unknown>>;
};

function error(message: string): ControlResponse { return { ok: false, error: message }; }
function success(command: string, data: Record<string, unknown> = {}): ControlResponse { return { ok: true, command, ...data }; }

function targetValue(request: ControlRequest): Target {
  const target = request.target;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) throw new Error('target must be an object');
  return target as Target;
}

function targetDescription(target: Target): string {
  if (target.label !== undefined) return `label=${target.label}`;
  if (target.placeholder !== undefined) return `placeholder=${target.placeholder}`;
  if (target.role !== undefined) return `role=${target.role}/${target.name ?? ''}`;
  if (target.css !== undefined) return `css=${target.css}`;
  throw new Error('target requires label, placeholder, role, or css');
}

function locator(page: Page, target: Target): Locator {
  if (target.label !== undefined) return page.getByLabel(target.label, { exact: true });
  if (target.placeholder !== undefined) return page.getByPlaceholder(target.placeholder, { exact: true });
  if (target.role !== undefined) {
    if (target.name === undefined) throw new Error('role target requires name');
    return page.getByRole(target.role as Parameters<Page['getByRole']>[0], { name: target.name, exact: true });
  }
  if (target.css !== undefined) return page.locator(target.css).nth(target.index ?? 0);
  throw new Error('target requires label, placeholder, role, or css');
}

async function withAgentGuard<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => { window.__sharedBrowserAgentAction = true; });
  try { return await action(); } finally { await page.evaluate(() => { window.__sharedBrowserAgentAction = false; }); }
}

async function pageMetadata(page: Page): Promise<PageMetadata> {
  const elements = await page.locator('a,button,input,textarea,select,[contenteditable="true"]').evaluateAll((nodes) => nodes
    .filter((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map((node) => {
      const element = node as HTMLInputElement;
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute('role') ?? (tagName === 'button' ? 'button' : tagName === 'a' ? 'link' : tagName);
      const name = element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? element.innerText?.trim() ?? '';
      return {
        tagName,
        role,
        name: name.slice(0, 200),
        type: element.getAttribute('type') ?? '',
        insideForm: element.closest('form') !== null,
        empty: 'value' in element ? (element as HTMLInputElement).value.length === 0 : false,
        disabled: 'disabled' in element ? (element as HTMLInputElement).disabled : false,
      };
    }));
  return { url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 20_000), elements };
}

class PlaywrightTabPage implements TabPage {
  constructor(readonly page: Page, readonly handle: string, private readonly pageLoadTimeoutMs: number) {}
  url(): string { return this.page.url(); }
  async goto(url: string): Promise<unknown> { return this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.pageLoadTimeoutMs }); }
  async title(): Promise<string> { return this.page.title(); }
  async close(): Promise<void> { await this.page.close(); }
  async bringToFront(): Promise<void> { await this.page.bringToFront(); }
  async acceptCookieConsent(): Promise<boolean> {
    for (const frame of this.page.frames()) {
      const controls = frame.getByRole('button').or(frame.getByRole('link'));
      const count = await controls.count().catch(() => 0);
      for (let index = 0; index < Math.min(count, 100); index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible().catch(() => false))) continue;
        const label = (await control.getAttribute('aria-label').catch(() => null))
          ?? (await control.innerText().catch(() => ''));
        const context = await control.evaluate((node) => {
          const element = node as HTMLElement;
          const container = element.closest('[role="dialog"],dialog,[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]');
          return (container?.textContent ?? '').slice(0, 5_000);
        }).catch(() => '');
        if (!classifyCookieConsentCandidate({ label, context })) continue;
        await control.click({ timeout: this.pageLoadTimeoutMs, noWaitAfter: true });
        await this.page.waitForLoadState('domcontentloaded', { timeout: this.pageLoadTimeoutMs }).catch(() => undefined);
        return true;
      }
    }
    return false;
  }
  async inspectIdentity(): Promise<{ title: string; text: string; forms: Array<{ id: string; name: string; action: string; ariaLabel: string; text: string }> }> {
    return this.page.evaluate(() => ({
      title: document.title,
      text: document.body?.innerText?.slice(0, 20_000) ?? '',
      forms: Array.from(document.forms).map((form) => ({
        id: form.id,
        name: form.getAttribute('name') ?? '',
        action: form.getAttribute('action') ?? '',
        ariaLabel: form.getAttribute('aria-label') ?? '',
        text: form.innerText.slice(0, 1_000),
      })),
    }));
  }
}

export class SharedBrowser {
  private xvfb: ManagedProcess | undefined;
  private vnc: ManagedProcess | undefined;
  private context: BrowserContext | undefined;
  private tabs: OpportunityTabs | undefined;
  private server: ControlServer | undefined;
  private stopping = false;
  private readonly logger: RuntimeLogger;
  private readonly display: string;

  constructor(private readonly config: BrowserConfig, private readonly localMode = false, displayOverride?: string) {
    this.display = displayOverride ?? config.display;
    this.logger = new RuntimeLogger(config.logFile);
  }

  async start(): Promise<void> {
    await this.logger.reset();
    await writePidFile(this.config.pidFile, process.pid);
    this.logger.write(`supervisor starting pid=${process.pid}`);
    if (!this.localMode) await probeTcpPort(this.config.vncPort);
    await mkdir(this.config.profileDir, { recursive: true });
    const display = this.display;
    if (!this.localMode) {
      displayNumber(display);
      this.xvfb = this.spawnOwned('Xvfb', 'Xvfb', [display, '-screen', '0', `${this.config.screenWidth}x${this.config.screenHeight}x${this.config.screenDepth}`, '-nolisten', 'tcp']);
      await this.wait(300);
    }
    try {
      this.context = await chromium.launchPersistentContext(this.config.profileDir, {
        headless: false,
        viewport: { width: this.config.screenWidth, height: this.config.screenHeight },
        args: ['--no-first-run', '--no-default-browser-check', '--restore-last-session'],
        env: { ...process.env, DISPLAY: display, ...(process.env.XAUTHORITY === undefined ? {} : { XAUTHORITY: process.env.XAUTHORITY }) },
      });
      this.context.on('close', () => this.logger.write('Chromium closed'));
      this.logger.write('Chromium started');
      await this.context.addInitScript({ content: submitGuard });
      const restored = this.context.pages().map((page, index) => this.tabPage(page, `restored-${index + 1}`));
      this.tabs = new OpportunityTabs(restored, async () => this.tabPage(await this.context!.newPage(), randomUUID()));
      if (!this.localMode) {
        this.vnc = this.spawnOwned('x11vnc', 'x11vnc', ['-display', display, '-rfbport', String(this.config.vncPort), '-localhost', '-nopw', '-forever', '-shared', '-noxrecord', '-ncache', '10', '-ncache_cr']);
        await this.wait(300);
      }
      this.server = new ControlServer(this.config.socketPath, (request) => this.handle(request));
      await this.server.start();
      this.logger.write(`supervisor ready mode=${this.localMode ? 'local' : 'vnc'} display=${display}`);
      process.once('SIGINT', () => { void this.stop(); });
      process.once('SIGTERM', () => { void this.stop(); });
      await new Promise<void>((resolve) => { this.resolveStop = resolve; });
    } catch (cause) {
      this.logger.write(`startup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      await this.stopChildren();
      removePidFile(this.config.pidFile);
      throw cause;
    }

  }

  private resolveStop: (() => void) | undefined;

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.server?.stop().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.stopChildren();
    removePidFile(this.config.pidFile);
    this.logger.write('supervisor stopped');
    this.resolveStop?.();
  }

  private async stopChildren(): Promise<void> {
    for (const managed of [this.vnc, this.xvfb]) {
      if (managed === undefined) continue;
      if (managed.child.exitCode === null) {
        const pid = managed.child.pid;
        if (pid !== undefined && process.platform !== 'win32') {
          try { process.kill(-pid, 'SIGTERM'); } catch { /* already exited */ }
        } else {
          managed.child.kill('SIGTERM');
        }
        await new Promise<void>((resolve) => {
          if (managed.child.exitCode !== null) { resolve(); return; }
          const timer = setTimeout(() => {
            if (managed.child.exitCode === null) {
              if (pid !== undefined && process.platform !== 'win32') {
                try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
              } else managed.child.kill('SIGKILL');
            }
            resolve();
          }, 5_000);
          managed.child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
    }
    this.vnc = undefined;
    this.xvfb = undefined;
  }

  async statusResponse(): Promise<ControlResponse> {
    return success('status', {
      state: this.stopping ? 'stopping' : this.server === undefined ? 'starting' : 'running',
      display: this.display,
      vncPort: this.config.vncPort,
      mode: this.localMode ? 'local' : 'vnc',
      controlSocket: this.config.socketPath,
      supervisorPid: process.pid,
      pidFile: this.config.pidFile,
      logFile: this.config.logFile,
      xvfb: this.localMode ? 'not-used' : this.xvfb?.child.exitCode === null ? 'running' : 'stopped',
      chromium: this.context === undefined ? 'stopped' : 'running',
      x11vnc: this.localMode ? 'not-used' : this.vnc?.child.exitCode === null ? 'running' : 'stopped',
      tabs: this.tabs === undefined ? [] : await this.tabs.list(),
      unboundTabs: this.tabs === undefined ? [] : await this.tabs.listUnbound(),
    });
  }

  private spawnOwned(name: string, command: string, args: string[]): ManagedProcess {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, DISPLAY: this.config.display } });
    this.logger.write(`${name} started pid=${child.pid ?? 'unknown'}`);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u).filter((entry) => entry !== '')) {
        this.logger.write(`${name}: ${line}`);
      }
    });
    child.once('error', (cause) => { this.logger.write(`${name} error: ${cause.message}`); });
    child.once('exit', (code, signal) => {
      if (!this.stopping) this.logger.write(`${name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    return { child, name };
  }

  private async handle(request: ControlRequest): Promise<ControlResponse> {
    try {
      if (request.op === 'status') return this.statusResponse();
      if (request.op === 'stop') { void this.stop(); return success('stop', { state: 'stopping' }); }
      if (this.tabs === undefined) return error('browser tabs are not ready');
      if (request.op === 'list-tabs') return success('list-tabs', { tabs: await this.tabs.list() });
      if (request.op === 'list-unbound-tabs') return success('list-unbound-tabs', { tabs: await this.tabs.listUnbound() });
      if (request.op === 'open-url') {
        const opened = await this.tabs.open(request.tabId, request.url);
        if (!opened.ok) return opened;
        const selected = await this.tabs.require(request.tabId);
        if (selected.ok) await selected.page.acceptCookieConsent();
        return opened;
      }
      if (request.op === 'close-tab') return this.tabs.close(request.tabId);
      if (request.op === 'rebind-tab') {
        const rebound = await this.tabs.rebind(request);
        if (!rebound.ok) return rebound;
        const selected = await this.tabs.require(request.tabId);
        if (selected.ok) await selected.page.acceptCookieConsent();
        return rebound;
      }
      if (request.op === 'inspect') {
        const selected = await this.tabs.require(request.tabId);
        if (!selected.ok) return selected;
        await selected.page.acceptCookieConsent();
        return success('inspect', await pageMetadata((selected.page as PlaywrightTabPage).page));
      }
      if (request.op === 'click') return this.click(request);
      if (request.op === 'fill') return this.fill(request);
      return error(`unsupported operation: ${request.op}`);
    } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause)); }
  }

  private async click(request: ControlRequest): Promise<ControlResponse> {
    if (this.tabs === undefined) return error('browser tabs are not ready');
    const scoped = await this.tabs.run(request.tabId, request.expectedOrigin, async (tab) => {
    const browserTab = tab as PlaywrightTabPage;
    const page = browserTab.page;
    const target = targetValue(request);
    return withCookieConsentRetry(async () => {
      const selected = locator(page, target);
      const metadata = await selected.evaluate((node) => {
        const element = node as HTMLElement & { type?: string };
        return { tagName: element.tagName, role: element.getAttribute('role') ?? '', type: element.getAttribute('type') ?? element.type ?? '', insideForm: element.closest('form') !== null, accessibleName: element.getAttribute('aria-label') ?? element.innerText ?? '' };
      });
      const safety = classifyClickSafety(metadata);
      if (!safety.ok) return error(safety.reason);
      const popup = this.context?.waitForEvent('page', { timeout: this.config.actionTimeoutMs }).catch(() => undefined);
      await withAgentGuard(page, () => selected.click({ timeout: this.config.actionTimeoutMs, noWaitAfter: true }));
      const openedPage = await popup;
      if (openedPage !== undefined) {
        await openedPage.waitForLoadState('domcontentloaded', { timeout: this.config.pageLoadTimeoutMs }).catch(() => undefined);
        await openedPage.close().catch(() => undefined);
      }
      await page.waitForLoadState('domcontentloaded', { timeout: this.config.pageLoadTimeoutMs }).catch(() => undefined);
      return { target: targetDescription(target), url: page.url(), title: await page.title() };
    }, () => browserTab.acceptCookieConsent());
    });
    return scoped.ok ? success('click', scoped.value as Record<string, unknown>) : scoped;
  }

  private async fill(request: ControlRequest): Promise<ControlResponse> {
    if (this.tabs === undefined) return error('browser tabs are not ready');
    const scoped = await this.tabs.run(request.tabId, request.expectedOrigin, async (tab) => {
    const browserTab = tab as PlaywrightTabPage;
    const page = browserTab.page;
    const fields = request.fields;
    if (!Array.isArray(fields)) return error('fields must be an array');
    return withCookieConsentRetry(async () => {
      const completed: string[] = [];
      for (const field of fields) {
        if (field === null || typeof field !== 'object' || Array.isArray(field)) return error('each field must be an object');
        const item = field as Record<string, unknown>;
        const target = item.target as Target;
        const selected = locator(page, target);
        await withAgentGuard(page, async () => {
          if (typeof item.filePath === 'string') await selected.setInputFiles(item.filePath, { timeout: this.config.actionTimeoutMs });
          else if (item.select === true && typeof item.value === 'string') await selected.selectOption(item.value, { timeout: this.config.actionTimeoutMs });
          else if (typeof item.checked === 'boolean') await selected.setChecked(item.checked, { timeout: this.config.actionTimeoutMs });
          else if (typeof item.value === 'string') await selected.fill(item.value, { timeout: this.config.actionTimeoutMs });
          else throw new Error('field requires value, checked, or filePath');
        });
        completed.push(targetDescription(target));
      }
      return { fields: completed };
    }, () => browserTab.acceptCookieConsent());
    });
    return scoped.ok ? success('fill', scoped.value as Record<string, unknown>) : scoped;
  }

  private tabPage(page: Page, handle: string): PlaywrightTabPage { return new PlaywrightTabPage(page, handle, this.config.pageLoadTimeoutMs); }

  private async wait(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }
}
