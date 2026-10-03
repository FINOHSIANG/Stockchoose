import { describe, expect, it, vi } from "vitest";
import { fetchDatacenterRows } from "../bun-api/services/datacenter";

const pageUrl = (page: number) => new URL(`https://example.com/?page=${page}`);
const payload = (count: number, data: unknown[], pages?: number) => ({ success: true, result: { count, pages, data } });

describe("datacenter pagination", () => {
  it("uses observed upstream pagination even when requested page size is capped", async () => {
    const fetchPage = vi.fn(async (url: URL) => {
      const page = Number(url.searchParams.get("page"));
      return payload(5, page === 3 ? [{ code: 5 }] : [{ code: page * 2 - 1 }, { code: page * 2 }], 3);
    });
    const rows = await fetchDatacenterRows(pageUrl, { fetchPage });
    expect(rows.map((row) => row.code)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("fails rather than silently truncating a financial universe", async () => {
    await expect(fetchDatacenterRows(pageUrl, { maxPages: 2, fetchPage: async () => payload(6, [{ code: 1 }, { code: 2 }], 3) }))
      .rejects.toThrow("refusing truncated");
  });

  it("supports intentional single-page date discovery separately from full downloads", async () => {
    const fetchPage = vi.fn(async () => payload(20000, [{ date: "2026-09-09" }], 20000));
    await expect(fetchDatacenterRows(pageUrl, { firstPageOnly: true, fetchPage })).resolves.toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete pages and an upstream error disguised as HTTP 200", async () => {
    await expect(fetchDatacenterRows(pageUrl, {
      fetchPage: async (url) => payload(3, url.searchParams.get("page") === "1" ? [{ code: 1 }, { code: 2 }] : [], 2)
    })).rejects.toThrow("incomplete");
    await expect(fetchDatacenterRows(pageUrl, { fetchPage: async () => ({ success: false, result: null }) })).rejects.toThrow("invalid");
  });

  it("does not merge pages belonging to different snapshots", async () => {
    await expect(fetchDatacenterRows(pageUrl, {
      fetchPage: async (url) => payload(url.searchParams.get("page") === "1" ? 2 : 3, [{ code: 1 }], 2)
    })).rejects.toThrow("count changed");
  });
});
