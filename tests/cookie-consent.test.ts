import { describe, expect, it } from 'vitest';

import { classifyCookieConsentCandidate, withCookieConsentRetry } from '../src/cookie-consent.js';

describe('cookie consent automation', () => {
  it('accepts only unmistakable cookie-specific accept-all controls', () => {
    expect(classifyCookieConsentCandidate({ label: 'Accept All Cookies', context: 'Cookie preferences' })).toBe(true);
    expect(classifyCookieConsentCandidate({ label: 'Allow all cookies', context: '' })).toBe(true);
    expect(classifyCookieConsentCandidate({ label: 'Accept all', context: 'We use cookies. Manage cookie preferences.' })).toBe(true);
    expect(classifyCookieConsentCandidate({ label: 'Accept All Cookies', context: 'Cookies may process personal data. See our privacy policy.' })).toBe(true);
  });

  it('rejects ambiguous or broader consent controls', () => {
    expect(classifyCookieConsentCandidate({ label: 'Accept', context: 'Privacy notice and applicant data processing' })).toBe(false);
    expect(classifyCookieConsentCandidate({ label: 'Continue', context: 'We use cookies' })).toBe(false);
    expect(classifyCookieConsentCandidate({ label: 'I agree', context: 'Terms of service' })).toBe(false);
    expect(classifyCookieConsentCandidate({ label: 'Accept all', context: 'Applicant privacy consent' })).toBe(false);
    expect(classifyCookieConsentCandidate({ label: 'Accept marketing', context: 'Cookie preferences' })).toBe(false);
  });

  it('accepts before the action and retries exactly once only when a newly found cookie banner blocked it', async () => {
    const events: string[] = [];
    let consentCalls = 0;
    let actionCalls = 0;
    const result = await withCookieConsentRetry(
      async () => {
        actionCalls += 1;
        events.push(`action-${actionCalls}`);
        if (actionCalls === 1) throw new Error('covered');
        return 'done';
      },
      async () => {
        consentCalls += 1;
        events.push(`consent-${consentCalls}`);
        return consentCalls === 2;
      },
    );
    expect(result).toBe('done');
    expect(events).toEqual(['consent-1', 'action-1', 'consent-2', 'action-2']);
  });

  it('does not retry when no clear cookie control is found after failure', async () => {
    let actions = 0;
    await expect(withCookieConsentRetry(
      async () => { actions += 1; throw new Error('timed out'); },
      async () => false,
    )).rejects.toThrow('timed out');
    expect(actions).toBe(1);
  });
});
