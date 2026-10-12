/** Trims whitespace and trailing slashes; unset or blank input yields "". */
export function normalizeWorkerUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}
