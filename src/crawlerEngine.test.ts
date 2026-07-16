import { describe, expect, it } from "vitest";
import { cacheGetOrCreate, mapConcurrent } from "../bun-api/crawler/engine";

describe("crawler engine concurrency", () => {
  it("deduplicates concurrent cache misses into one upstream request", async () => {
    const key = `single-flight-${Date.now()}-${Math.random()}`;
    let calls = 0;
    let release!: (value: number) => void;
    const loaderResult = new Promise<number>((resolve) => {
      release = resolve;
    });
    const loader = async () => {
      calls += 1;
      return loaderResult;
    };

    const first = cacheGetOrCreate(key, 1000, loader);
    const second = cacheGetOrCreate(key, 1000, loader);
    release(5539);

    await expect(Promise.all([first, second])).resolves.toEqual([5539, 5539]);
    expect(calls).toBe(1);
    await expect(cacheGetOrCreate(key, 1000, loader)).resolves.toBe(5539);
    expect(calls).toBe(1);
  });

  it("keeps mapper concurrency within the configured worker limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapConcurrent([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(3);
  });
});
