// Text a patient controls (their WhatsApp profile name, names and answers
// they give) ends up in the assistant's context. One line, no control
// characters and a length cap keep it from reading as instructions.
export function oneLine(text: string, max: number) {
  return text
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const NAME_MAX = 80;
export const ANSWER_MAX = 300;
export const REASON_MAX = 300;

// A DUI as people type it: 8 digits, then the check digit, with or without
// a dash or space.
const DUI = /(?<!\d)(\d{8})[- ]?(\d)(?!\d)/g;

// DUIs never go to the LLM provider. Each one in the conversation is
// replaced by a token like "[DUI 1]", which the tools turn back into the DUI.
export class DuiVault {
  private byToken = new Map<string, string>();
  private byDui = new Map<string, string>();

  mask(text: string) {
    return text.replace(DUI, (_, body: string, check: string) => {
      const dui = `${body}-${check}`;
      let token = this.byDui.get(dui);
      if (!token) {
        token = `[DUI ${this.byDui.size + 1}]`;
        this.byDui.set(dui, token);
        this.byToken.set(token, dui);
      }
      return token;
    });
  }

  // The DUI behind a token, or the value as given. Models don't always copy
  // the token exactly ("DUI 1", "[DUI 1] (oculto)", "dui #1"), so any
  // mention of one counts.
  resolve(value: string) {
    const n = /DUI\W{0,3}(\d{1,2})(?!\d)/i.exec(value)?.[1];
    return (n && this.byToken.get(`[DUI ${n}]`)) || value;
  }

  get size() {
    return this.byToken.size;
  }
}
