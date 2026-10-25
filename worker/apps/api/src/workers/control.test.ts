import { describe, expect, test } from "bun:test";
import { handleControl, lanAddress } from "./control";

const ID = "3f9a0c1d2e4b5a67";
const KEY = "a".repeat(48);
const SAVED = "b".repeat(48);
const ADDR = "192.168.1.5:9978";

function open(query: string, cookie?: string) {
  return handleControl(new Request(`https://tv.example/link?${query}`, { headers: cookie ? { cookie } : {} }));
}

function target(res: Response) {
  return new URL(res.headers.get("location") ?? "");
}

describe("phone control entry", () => {
  test("first scan: keeps the key as this TV's token and sends the phone to the TV with it", () => {
    const res = open(`${ID}/${KEY}/${ADDR}`);
    expect(res.status).toBe(302);
    const to = target(res);
    expect(to.origin).toBe(`http://${ADDR}`);
    expect(to.pathname).toBe("/");
    expect(Object.fromEntries(to.searchParams)).toEqual({ token: KEY, d: ID, via: "https://tv.example/link" });
    expect(res.headers.get("set-cookie")).toBe(`tv_${ID}=${KEY}; Path=/link; Max-Age=315360000; HttpOnly; Secure; SameSite=Lax`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a later scan of the same TV on a new address reuses the saved token and passes the new key along", () => {
    const res = open(`${ID}/${KEY}/10.0.0.7:9979`, `x=1; tv_${ID}=${SAVED}`);
    const to = target(res);
    expect(to.origin).toBe("http://10.0.0.7:9979");
    expect(to.searchParams.get("token")).toBe(SAVED);
    expect(to.searchParams.get("key")).toBe(KEY);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("another TV does not get this one's token", () => {
    const res = open(`0000000000000001/${KEY}/${ADDR}`, `tv_${ID}=${SAVED}`);
    expect(target(res).searchParams.get("token")).toBe(KEY);
  });

  test("renew (the TV page replacing a token the TV no longer knows) saves the given token", () => {
    const res = open(`${ID}/${KEY}/${ADDR}/renew`, `tv_${ID}=${SAVED}`);
    expect(target(res).searchParams.get("token")).toBe(KEY);
    expect(target(res).searchParams.get("key")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain(`tv_${ID}=${KEY};`);
  });

  test("rejects a bad device id, key or address", async () => {
    expect(open(`tv_1/${KEY}/${ADDR}`).status).toBe(400);
    expect(open(`${ID}/short/${ADDR}`).status).toBe(400);
    expect(open(`${ID}/${KEY}`).status).toBe(400);
    expect(open(`${ID}/${KEY}/evil.example`).status).toBe(400);
    expect(await open(`${ID}/${KEY}/8.8.8.8`).text()).toBe("Bad request");
    expect(handleControl(new Request("https://tv.example/link")).status).toBe(400);
  });
});

describe("lanAddress", () => {
  test("accepts private IPv4 hosts with an optional port only", () => {
    expect(lanAddress("192.168.1.5:9978")?.origin).toBe("http://192.168.1.5:9978");
    expect(lanAddress("10.1.2.3")?.origin).toBe("http://10.1.2.3");
    expect(lanAddress("172.16.0.1:9978")?.origin).toBe("http://172.16.0.1:9978");
    expect(lanAddress("172.31.255.1")).toBeDefined();
    for (const bad of ["172.32.0.1", "8.8.8.8", "tv.local:9978", "u:p@10.0.0.1", "10.0.0.1/x", "10.0.0.1:99999", ""])
      expect(lanAddress(bad)).toBeUndefined();
  });
});
