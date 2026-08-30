export interface CookieConsentCandidate {
  label: string;
  context: string;
}

const explicitAcceptAllCookies = /\b(?:accept|allow)\s+(?:all\s+)?cookies\b/iu;
const acceptAll = /^\s*accept\s+all\s*$/iu;
const cookieContext = /\bcookies?\b/iu;
const broaderConsent = /\b(applicant|application|candidate|recruit(?:ing|ment)?|personal data|data processing|terms(?: of (?:use|service))?|newsletter|email communications?)\b/iu;
const ambiguousLabel = /^\s*(?:accept|agree|continue|ok(?:ay)?|allow)\s*$/iu;

export function classifyCookieConsentCandidate(candidate: CookieConsentCandidate): boolean {
  const label = candidate.label.trim();
  const combined = `${label}\n${candidate.context}`;
  if (/\bmarketing\b/iu.test(label)) return false;
  if (explicitAcceptAllCookies.test(label)) return true;
  if (broaderConsent.test(combined)) return false;
  if (acceptAll.test(label) && cookieContext.test(candidate.context)) return true;
  if (ambiguousLabel.test(label)) return false;
  return false;
}

/**
 * Cookie acceptance is attempted before every browser action. If the action
 * fails and a newly surfaced clear cookie banner is accepted, retry once.
 */
export async function withCookieConsentRetry<T>(
  action: () => Promise<T>,
  acceptCookieBanner: () => Promise<boolean>,
): Promise<T> {
  await acceptCookieBanner();
  try {
    return await action();
  } catch (cause) {
    if (!(await acceptCookieBanner())) throw cause;
    return await action();
  }
}
