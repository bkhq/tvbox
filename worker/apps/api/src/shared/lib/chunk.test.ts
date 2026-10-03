import { describe, expect, test } from "bun:test";
import { chunked } from "./chunk";

describe("chunked", () => {
  test("splits into groups of at most the size", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 2)).toEqual([]);
    expect(chunked(Array.from({ length: 181 }, (_, i) => i)).map(c => c.length)).toEqual([90, 90, 1]);
  });
});
