export interface ClickMetadata {
  tagName: string;
  type: string;
  insideForm: boolean;
  accessibleName: string;
}

const finalizationWords = /\b(submit|save|send|confirm|purchase|buy|checkout|place order|apply)\b/iu;

export function classifyClickSafety(metadata: ClickMetadata): { ok: true } | { ok: false; reason: string } {
  const tag = metadata.tagName.toUpperCase();
  const type = metadata.type.toLowerCase();
  if (tag !== 'A' && finalizationWords.test(metadata.accessibleName)) return { ok: false, reason: 'control appears to finalize or submit data' };
  if (type === 'submit' || type === 'image') return { ok: false, reason: 'submit controls are not allowed' };
  if (tag === 'BUTTON' && type !== 'button' && metadata.insideForm) return { ok: false, reason: 'button inside a form has ambiguous submit behavior' };
  if (tag !== 'A' && tag !== 'BUTTON' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
    return { ok: false, reason: 'element type is not an approved navigation control' };
  }
  return { ok: true };
}
