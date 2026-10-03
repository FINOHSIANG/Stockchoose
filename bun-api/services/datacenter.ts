import { fetchJson, mapConcurrent } from "../crawler/engine";
import { finiteDataNumber } from "../../src/dataContracts";

interface Page {
  rows: Record<string, unknown>[];
  count: number;
  pages?: number;
}

function parsePage(payload: unknown): Page {
  const root = payload as { success?: boolean; message?: string; result?: { count?: unknown; pages?: unknown; data?: unknown } } | null;
  const count = finiteDataNumber(root?.result?.count);
  const rows = root?.result?.data;
  if (root?.success === false || count === undefined || !Number.isInteger(count) || count < 0
      || !Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Datacenter returned an invalid or unsuccessful page");
  }
  return { rows, count, pages: finiteDataNumber(root?.result?.pages) };
}

export async function fetchDatacenterRows(
  pageUrl: (page: number) => URL,
  options: { maxPages?: number; firstPageOnly?: boolean; fetchPage?: (url: URL) => Promise<unknown> } = {}
) {
  const fetchPage = options.fetchPage ?? ((url) =>
    fetchJson(url, { headers: { referer: "https://data.eastmoney.com/" } }, 30000, 90));
  const first = parsePage(await fetchPage(pageUrl(1)));
  if (options.firstPageOnly) return first.rows;
  if (!first.count) {
    if (first.rows.length) throw new Error("Datacenter count does not match rows");
    return [];
  }
  if (!first.rows.length) throw new Error("Datacenter first page is empty");
  const pages = first.pages ?? Math.ceil(first.count / first.rows.length);
  if (!Number.isInteger(pages) || pages < 1 || pages > (options.maxPages ?? 30)) {
    throw new Error(`Datacenter page count ${pages} exceeds the request budget; refusing truncated data`);
  }
  const remaining = await mapConcurrent(Array.from({ length: pages - 1 }, (_, index) => index + 2), 6, async (page) => {
    const next = parsePage(await fetchPage(pageUrl(page)));
    if (next.count !== first.count) throw new Error("Datacenter count changed during pagination");
    return next.rows;
  });
  const rows = [...first.rows, ...remaining.flat()];
  if (rows.length !== first.count) throw new Error(`Datacenter incomplete: ${rows.length}/${first.count} rows`);
  return rows;
}
