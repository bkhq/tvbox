/**
 * `/link?<id>/<key>/<address>`: the stable entry of the phone control page. The TV's QR code opens it with its device
 * id, a one-time key and its LAN `ip:port`. The phone keeps one token per TV in a cookie under this host and is sent
 * on to the TV's own page with it, so a TV that changed address is just a new address: the same id reuses the saved
 * token. A first scan keeps the key itself, which the TV turns into this phone's token on first use. A trailing
 * `/renew` saves the given token instead (the TV page replacing one the TV no longer knows).
 */
const QUERY = /^\?([0-9a-z-]{1,64})\/([^/]+)\/([^/]+)(\/renew)?$/i;
const TOKEN = /^[0-9a-f]{32,128}$/;
const COOKIE_ATTRIBUTES = "Path=/link; Max-Age=315360000; HttpOnly; Secure; SameSite=Lax";

export const LINK_PATH = "/link";

/** `value` (`ip[:port]`) as an http origin on a private IPv4 address, else undefined: the redirect stays on the LAN. */
export function lanAddress(value: string): URL | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(value);
  if (!match)
    return undefined;
  const [a, b, c, d] = match.slice(1, 5).map(Number) as [number, number, number, number];
  const port = match[5] === undefined
    ? undefined
    : Number(match[5]);
  if ([a, b, c, d].some(o => o > 255) || (port !== undefined && (port < 1 || port > 65535)))
    return undefined;
  const lan = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return lan
    ? new URL(`http://${value}/`)
    : undefined;
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name)
      return value.join("=");
  }
  return undefined;
}

function token(value: string | undefined) {
  return value && TOKEN.test(value)
    ? value
    : undefined;
}

export function handleControl(request: Request): Response {
  const url = new URL(request.url);
  const [, device = "", given, rawAddress = "", renew] = QUERY.exec(url.search) ?? [];
  const key = token(given);
  const address = lanAddress(rawAddress);
  if (!device || !key || !address)
    return new Response("Bad request", { status: 400 });

  const name = `tv_${device}`;
  const saved = token(cookie(request, name));
  const chosen = renew
    ? key
    : (saved ?? key);
  const to = new URL("/", address);
  to.searchParams.set("token", chosen);
  if (key !== chosen)
    to.searchParams.set("key", key);
  to.searchParams.set("d", device);
  to.searchParams.set("via", `${url.origin}${LINK_PATH}`);
  const headers = new Headers({
    "location": to.toString(),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (chosen !== saved)
    headers.set("set-cookie", `${name}=${chosen}; ${COOKIE_ATTRIBUTES}`);
  return new Response(null, { status: 302, headers });
}
