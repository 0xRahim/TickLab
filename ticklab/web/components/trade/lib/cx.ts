/** Minimal classnames join — no extra dependency for the stub UI. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
