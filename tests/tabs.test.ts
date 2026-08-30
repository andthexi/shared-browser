import { describe, expect, it } from 'vitest';

import { OpportunityTabs, type TabPage } from '../src/tabs.js';

class FakePage implements TabPage {
  closed = false;
  constructor(
    readonly handle: string,
    private currentUrl: string,
    readonly metadata: {
      title: string;
      text: string;
      forms: Array<{ id: string; name: string; action: string; ariaLabel: string; text: string }>;
    } = { title: '', text: '', forms: [] },
  ) {}
  url(): string { return this.currentUrl; }
  async goto(url: string): Promise<void> { this.currentUrl = url; }
  async title(): Promise<string> { return this.metadata.title; }
  async close(): Promise<void> { this.closed = true; }
  async bringToFront(): Promise<void> {}
  async acceptCookieConsent(): Promise<boolean> { return false; }
  async inspectIdentity(): Promise<typeof this.metadata> { return this.metadata; }
}

function page(handle: string, url: string): FakePage {
  return new FakePage(handle, url);
}

describe('opportunity-scoped tabs', () => {
  it('opens a missing tab, reuses the exact URL, and rejects changing its URL', async () => {
    const created: FakePage[] = [];
    const tabs = new OpportunityTabs([], async () => {
      const result = page(`page-${created.length + 1}`, 'about:blank');
      created.push(result);
      return result;
    });

    const first = await tabs.open('opp-123', 'https://jobs.example.test/acme/engineer');
    const reused = await tabs.open('opp-123', 'https://jobs.example.test/acme/engineer');

    expect(first).toMatchObject({ ok: true, reused: false, tabId: 'opp-123' });
    expect(reused).toMatchObject({ ok: true, reused: true, tabId: 'opp-123' });
    expect(created).toHaveLength(1);
    expect(await tabs.open('opp-123', 'https://jobs.example.test/other')).toEqual({
      ok: false,
      error: 'tab_conflict',
      tabId: 'opp-123',
      url: 'https://jobs.example.test/acme/engineer',
    });
  });

  it('lists and closes only the requested bound tab', async () => {
    let next = 0;
    const tabs = new OpportunityTabs([], async () => page(`page-${++next}`, 'about:blank'));
    await tabs.open('opp-a', 'https://a.example.test/job');
    await tabs.open('opp-b', 'https://b.example.test/job');

    expect(await tabs.list()).toEqual([
      { tabId: 'opp-a', pageHandle: 'page-1', url: 'https://a.example.test/job', title: '' },
      { tabId: 'opp-b', pageHandle: 'page-2', url: 'https://b.example.test/job', title: '' },
    ]);
    expect(await tabs.close('opp-a')).toMatchObject({ ok: true, tabId: 'opp-a' });
    expect((await tabs.require('opp-a')).ok).toBe(false);
    expect((await tabs.require('opp-b')).ok).toBe(true);
  });

  it.each(['', 'has space', '../escape', 'x'.repeat(129)])('rejects invalid bounded tab id %j', async (tabId) => {
    const tabs = new OpportunityTabs([], async () => page('page-1', 'about:blank'));
    expect(await tabs.open(tabId, 'https://example.test')).toMatchObject({ ok: false, error: 'invalid_tab_id' });
  });

  it('requires matching expected origin for scoped actions', async () => {
    const tabs = new OpportunityTabs([], async () => page('page-1', 'about:blank'));
    await tabs.open('opp-1', 'https://jobs.example.test/path');

    expect(await tabs.require('opp-1', 'https://jobs.example.test')).toMatchObject({ ok: true });
    expect(await tabs.require('opp-1', 'https://evil.example.test')).toEqual({
      ok: false,
      error: 'tab_conflict',
      tabId: 'opp-1',
      expectedOrigin: 'https://evil.example.test',
      actualOrigin: 'https://jobs.example.test',
    });
  });

  it('keeps restored pages unbound and rebinds only an unambiguous identity match', async () => {
    const matching = new FakePage('restored-1', 'https://jobs.example.test/acme/engineer', {
      title: 'Software Engineer - Acme',
      text: 'Acme Software Engineer application',
      forms: [{ id: 'application-form', name: 'application', action: '/apply', ariaLabel: 'Job application', text: 'Apply to Acme' }],
    });
    const other = new FakePage('restored-2', 'https://jobs.example.test/other', {
      title: 'Other role', text: 'OtherCo Designer', forms: [],
    });
    const tabs = new OpportunityTabs([matching, other], async () => page('new', 'about:blank'));

    expect(await tabs.list()).toEqual([]);
    expect(await tabs.listUnbound()).toEqual([
      { pageHandle: 'restored-1', url: 'https://jobs.example.test/acme/engineer', title: 'Software Engineer - Acme' },
      { pageHandle: 'restored-2', url: 'https://jobs.example.test/other', title: 'Other role' },
    ]);
    expect(await tabs.rebind({
      tabId: 'opp-acme', pageHandle: 'restored-1', expectedOrigin: 'https://jobs.example.test',
      expectedEmployer: 'Acme', expectedRole: 'Software Engineer', expectedFormIdentity: 'application-form',
    })).toMatchObject({ ok: true, tabId: 'opp-acme', pageHandle: 'restored-1' });
    expect(await tabs.listUnbound()).toHaveLength(1);
  });

  it('keeps a restored page unbound when identity is ambiguous or mismatched', async () => {
    const restored = new FakePage('restored-1', 'https://jobs.example.test/acme/engineer', {
      title: 'Software Engineer - Acme',
      text: 'Acme Software Engineer application',
      forms: [
        { id: 'application-form', name: '', action: '/apply', ariaLabel: '', text: '' },
        { id: '', name: 'application-form', action: '/apply/other', ariaLabel: '', text: '' },
      ],
    });
    const tabs = new OpportunityTabs([restored], async () => page('new', 'about:blank'));

    expect(await tabs.rebind({
      tabId: 'opp-acme', pageHandle: 'restored-1', expectedOrigin: 'https://jobs.example.test',
      expectedEmployer: 'Acme', expectedRole: 'Software Engineer', expectedFormIdentity: 'application-form',
    })).toMatchObject({ ok: false, error: 'ambiguous_rebind' });
    expect(await tabs.listUnbound()).toHaveLength(1);
    expect(await tabs.rebind({
      tabId: 'opp-acme', pageHandle: 'restored-1', expectedOrigin: 'https://jobs.example.test',
      expectedEmployer: 'Wrong Employer', expectedRole: 'Software Engineer', expectedFormIdentity: 'missing',
    })).toMatchObject({ ok: false, error: 'rebind_mismatch' });
    expect(await tabs.listUnbound()).toHaveLength(1);
  });

  it('requires all rebind identity fields and refuses already-bound handles and tab ids', async () => {
    const restored = new FakePage('restored-1', 'https://jobs.example.test/job', {
      title: 'Engineer at Acme', text: 'Acme Engineer',
      forms: [{ id: 'apply', name: '', action: '', ariaLabel: '', text: '' }],
    });
    const tabs = new OpportunityTabs([restored], async () => page('new', 'about:blank'));

    expect(await tabs.rebind({ tabId: 'opp-1', pageHandle: 'restored-1' })).toMatchObject({ ok: false, error: 'invalid_rebind' });
    expect(await tabs.rebind({
      tabId: 'opp-1', pageHandle: 'restored-1', expectedOrigin: 'https://jobs.example.test',
      expectedEmployer: 'Acme', expectedRole: 'Engineer', expectedFormIdentity: 'apply',
    })).toMatchObject({ ok: true });
    expect(await tabs.rebind({
      tabId: 'opp-2', pageHandle: 'restored-1', expectedOrigin: 'https://jobs.example.test',
      expectedEmployer: 'Acme', expectedRole: 'Engineer', expectedFormIdentity: 'apply',
    })).toMatchObject({ ok: false, error: 'unbound_tab_not_found' });
  });

  it('serializes operations for one tab while allowing different tabs concurrently', async () => {
    let next = 0;
    const tabs = new OpportunityTabs([], async () => page(`page-${++next}`, 'about:blank'));
    await tabs.open('opp-a', 'https://a.example.test');
    await tabs.open('opp-b', 'https://b.example.test');
    const events: string[] = [];
    let releaseA!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseA = resolve; });

    const a1 = tabs.run('opp-a', 'https://a.example.test', async () => { events.push('a1-start'); await blocked; events.push('a1-end'); });
    const a2 = tabs.run('opp-a', 'https://a.example.test', async () => { events.push('a2'); });
    const b = tabs.run('opp-b', 'https://b.example.test', async () => { events.push('b'); });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(['a1-start', 'b']);
    releaseA();
    await Promise.all([a1, a2, b]);
    expect(events).toEqual(['a1-start', 'b', 'a1-end', 'a2']);
  });
});
