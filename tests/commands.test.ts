import { describe, expect, it } from 'vitest';

import { commandPayload } from '../src/commands.js';

describe('CLI command payloads', () => {
  it('keeps status and tab listings unscoped', () => {
    expect(commandPayload(['status'])).toEqual({ op: 'status' });
    expect(commandPayload(['list-tabs'])).toEqual({ op: 'list-tabs' });
    expect(commandPayload(['list-unbound-tabs'])).toEqual({ op: 'list-unbound-tabs' });
  });

  it('parses log tail and follow options', () => {
    expect(commandPayload(['logs'])).toEqual({ op: 'logs' });
    expect(commandPayload(['logs', '--tail', '20'])).toEqual({ op: 'logs', tail: 20 });
    expect(commandPayload(['logs', '--follow'])).toEqual({ op: 'logs', follow: true });
  });

  it('requires tab ids for tab-scoped commands', () => {
    expect(commandPayload(['open-url', 'opp-1', 'https://example.test/job'])).toEqual({ op: 'open-url', tabId: 'opp-1', url: 'https://example.test/job' });
    expect(commandPayload(['inspect', 'opp-1'])).toEqual({ op: 'inspect', tabId: 'opp-1' });
    expect(commandPayload(['close-tab', 'opp-1'])).toEqual({ op: 'close-tab', tabId: 'opp-1' });
    expect(() => commandPayload(['inspect'])).toThrow('usage');
  });

  it('requires expected origin for click and fill', () => {
    expect(commandPayload(['click', 'opp-1', 'https://example.test', '{"role":"button","name":"Open"}'])).toEqual({
      op: 'click', tabId: 'opp-1', expectedOrigin: 'https://example.test', target: { role: 'button', name: 'Open' },
    });
    expect(commandPayload(['fill', 'opp-1', 'https://example.test', '[]'])).toEqual({
      op: 'fill', tabId: 'opp-1', expectedOrigin: 'https://example.test', fields: [],
    });
    expect(() => commandPayload(['click', 'opp-1'])).toThrow('usage');
  });

  it('requires all identity assertions when rebinding', () => {
    expect(commandPayload(['rebind-tab', 'opp-1', 'page-2', 'https://example.test', 'Acme', 'Engineer', 'application-form'])).toEqual({
      op: 'rebind-tab', tabId: 'opp-1', pageHandle: 'page-2', expectedOrigin: 'https://example.test',
      expectedEmployer: 'Acme', expectedRole: 'Engineer', expectedFormIdentity: 'application-form',
    });
    expect(() => commandPayload(['rebind-tab', 'opp-1', 'page-2'])).toThrow('usage');
  });
});
