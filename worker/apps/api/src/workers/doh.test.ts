import { describe, expect, test } from "bun:test";
import { DOH_UPSTREAM, handleDoh } from "./doh";

interface Seen { url: string; method: string; accept: string | null; type: string | null; body: string }

function upstream(status = 200, body = "answer", type = "application/dns-message") {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: Request) => {
    seen.push({
      url: input.url,
      method: input.method,
      accept: input.headers.get("accept"),
      type: input.headers.get("content-type"),
      body: await input.text(),
    });
    return new Response(body, { status, headers: { "content-type": type, "cache-control": "max-age=300", "set-cookie": "x=1" } });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("DoH forwarder", () => {
  test("a wire-format GET goes to Cloudflare with its query", async () => {
    const { seen, fetchImpl } = upstream();
    const res = await handleDoh(new Request("https://tv.example/dns-query?dns=AAABAAAB", { headers: { accept: "application/dns-message" } }), fetchImpl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("answer");
    expect(res.headers.get("content-type")).toBe("application/dns-message");
    expect(res.headers.get("cache-control")).toBe("max-age=300");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(seen[0]).toMatchObject({ url: `${DOH_UPSTREAM}?dns=AAABAAAB`, method: "GET", accept: "application/dns-message" });
  });

  test("a JSON query is passed through", async () => {
    const { seen, fetchImpl } = upstream(200, "{}", "application/dns-json");
    await handleDoh(new Request("https://tv.example/dns-query?name=example.com&type=A", { headers: { accept: "application/dns-json" } }), fetchImpl);
    expect(seen[0]).toMatchObject({ url: `${DOH_UPSTREAM}?name=example.com&type=A`, accept: "application/dns-json" });
  });

  test("a POST carries the message body", async () => {
    const { seen, fetchImpl } = upstream();
    await handleDoh(new Request("https://tv.example/dns-query", { method: "POST", body: "wire", headers: { "content-type": "application/dns-message" } }), fetchImpl);
    expect(seen[0]).toMatchObject({ method: "POST", type: "application/dns-message", body: "wire" });
  });

  test("other methods and oversized messages are refused before forwarding", async () => {
    const { seen, fetchImpl } = upstream();
    expect((await handleDoh(new Request("https://tv.example/dns-query", { method: "PUT", body: "x" }), fetchImpl)).status).toBe(405);
    const big = new Request("https://tv.example/dns-query", { method: "POST", body: "x".repeat(70_000), headers: { "content-type": "application/dns-message" } });
    expect((await handleDoh(big, fetchImpl)).status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  test("an unreachable upstream is a 502", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect((await handleDoh(new Request("https://tv.example/dns-query?dns=AA"), failing)).status).toBe(502);
  });
});
