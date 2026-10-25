/**
 * `/dns-query`: a DNS-over-HTTPS endpoint (RFC 8484, plus the JSON flavour)
 * that forwards to Cloudflare's resolver. Apps get one resolver address on
 * this domain, and the upstream can change without republishing configs.
 */

export const DOH_PATH = "/dns-query";
export const DOH_UPSTREAM = "https://cloudflare-dns.com/dns-query";

/** A DNS message cannot be larger than this. */
const MAX_MESSAGE = 65_535;

const PASSED_RESPONSE_HEADERS = ["content-type", "cache-control"];

export async function handleDoh(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, POST" },
    });
  }

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_MESSAGE)
      return new Response("Payload Too Large", { status: 413 });
  }

  const headers = new Headers({ accept: request.headers.get("accept") ?? "application/dns-message" });
  const type = request.headers.get("content-type");
  if (body && type)
    headers.set("content-type", type);

  let res: Response;
  try {
    res = await fetchImpl(new Request(`${DOH_UPSTREAM}${new URL(request.url).search}`, { method: request.method, headers, body: body ?? null }));
  }
  catch {
    return new Response("Bad Gateway", { status: 502 });
  }

  const out = new Headers();
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value)
      out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
