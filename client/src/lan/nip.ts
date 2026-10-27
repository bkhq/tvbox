/**
 * `http://<ip>.nip.io:<port>` for the TV's `http://<ip>:<port>`; '' for anything else. nip.io answers the IP written
 * in the name, so every address of the TV shares the nip.io cookie domain and the phone page keeps its token across
 * them.
 */
export function nipAddress(address: string): string {
  const match = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/.exec(address);
  return match ? `http://${match[1]}.nip.io${match[2] ?? ''}` : '';
}

/** Whether `url` answers within `timeoutMs`; some routers drop public names that resolve to LAN addresses. */
export async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return (await fetch(`${url}/`, { signal: abort.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
