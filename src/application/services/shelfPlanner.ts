import { Placement, SheetSpec } from "../../domain/models";
import { StickerDoesNotFitError } from "../../domain/errors";

export interface SizedAssetQty {
  assetId: string;
  qty: number;
  wMm: number;
  hMm: number;
}

export interface ShelfPaginationResult {
  placements: Placement[];
  totalPlaced: number;
  totalPages: number;
}

export function paginateByShelf(params: { sheet: SheetSpec; assets: SizedAssetQty[] }): ShelfPaginationResult {
  const { sheet, assets } = params;

  const placements: Placement[] = [];
  const usableW = sheet.sheetWmm - 2 * sheet.marginMm;
  const usableH = sheet.sheetHmm - 2 * sheet.marginMm;
  type Row = { yTopMm: number; heightMm: number; usedWidthMm: number };
  type Page = { rows: Row[]; usedHeightMm: number };
  type Item = { assetId: string; wMm: number; hMm: number };
  type Candidate = {
    pageIndex: number;
    rowIndex: number;
    isNewRow: boolean;
    wMm: number;
    hMm: number;
    rotate90: boolean;
    score: number;
  };

  const pages: Page[] = [];
  const allItems: Item[] = [];

  for (const a of assets) {
    const qty = Math.max(0, Math.trunc(a.qty));
    for (let i = 0; i < qty; i += 1) {
      allItems.push({ assetId: a.assetId, wMm: a.wMm, hMm: a.hMm });
    }
  }

  allItems.sort((a, b) => {
    const aMax = Math.max(a.wMm, a.hMm);
    const bMax = Math.max(b.wMm, b.hMm);
    if (bMax !== aMax) return bMax - aMax;
    const aArea = a.wMm * a.hMm;
    const bArea = b.wMm * b.hMm;
    return bArea - aArea;
  });

  const ensureFitsSheet = (wMm: number, hMm: number) => {
    if (wMm > usableW || hMm > usableH) throw new StickerDoesNotFitError();
  };

  const rowRemainingWidth = (row: Row): number => {
    const nextGap = row.usedWidthMm > 0 ? sheet.gapMm : 0;
    return usableW - row.usedWidthMm - nextGap;
  };

  const pickBestCandidateForPage = (item: Item, page: Page, pageIndex: number): Candidate | null => {
    let best: Candidate | null = null;
    const orientations: Array<{ w: number; h: number; rotate90: boolean }> = [
      { w: item.wMm, h: item.hMm, rotate90: false },
      { w: item.hMm, h: item.wMm, rotate90: true },
    ];

    for (const o of orientations) {
      ensureFitsSheet(o.w, o.h);

      for (let r = 0; r < page.rows.length; r += 1) {
        const row = page.rows[r];
        if (o.h > row.heightMm) continue;
        const remaining = rowRemainingWidth(row);
        if (o.w > remaining) continue;
        const leftover = remaining - o.w;
        const rowSlack = row.heightMm - o.h;
        const score = pageIndex * 1_000_000 + leftover + rowSlack * 0.25;
        if (!best || score < best.score) {
          best = { pageIndex, rowIndex: r, isNewRow: false, wMm: o.w, hMm: o.h, rotate90: o.rotate90, score };
        }
      }

      const newRowGap = page.rows.length > 0 ? sheet.gapMm : 0;
      const neededHeight = newRowGap + o.h;
      if (page.usedHeightMm + neededHeight <= usableH) {
        const rowWasteW = usableW - o.w;
        const score = pageIndex * 1_000_000 + 100_000 + rowWasteW + (usableH - (page.usedHeightMm + neededHeight)) * 0.01;
        if (!best || score < best.score) {
          best = {
            pageIndex,
            rowIndex: page.rows.length,
            isNewRow: true,
            wMm: o.w,
            hMm: o.h,
            rotate90: o.rotate90,
            score,
          };
        }
      }
    }
    return best;
  };

  const placeUsingCandidate = (item: Item, c: Candidate) => {
    const page = pages[c.pageIndex];
    if (!page) throw new Error("Pagina invalida.");

    if (c.isNewRow) {
      const gapBefore = page.rows.length > 0 ? sheet.gapMm : 0;
      const yTopMm = sheet.sheetHmm - sheet.marginMm - page.usedHeightMm - gapBefore;
      page.rows.push({ yTopMm, heightMm: c.hMm, usedWidthMm: 0 });
      page.usedHeightMm += gapBefore + c.hMm;
    }

    const row = page.rows[c.rowIndex];
    if (!row) throw new Error("Fila invalida.");

    const xGap = row.usedWidthMm > 0 ? sheet.gapMm : 0;
    const xMm = sheet.marginMm + row.usedWidthMm + xGap;
    const yMm = row.yTopMm - c.hMm;

    placements.push({
      pageIndex: c.pageIndex,
      xMm,
      yMm,
      assetId: item.assetId,
      wMm: c.wMm,
      hMm: c.hMm,
      rotate90: c.rotate90,
    });

    row.usedWidthMm += xGap + c.wMm;
  };

  for (const item of allItems) {
    const fitsNormal = item.wMm <= usableW && item.hMm <= usableH;
    const fitsRotated = item.hMm <= usableW && item.wMm <= usableH;
    if (!fitsNormal && !fitsRotated) throw new StickerDoesNotFitError();

    let bestOverall: Candidate | null = null;
    for (let p = 0; p < pages.length; p += 1) {
      const candidate = pickBestCandidateForPage(item, pages[p], p);
      if (candidate && (!bestOverall || candidate.score < bestOverall.score)) {
        bestOverall = candidate;
      }
    }

    if (!bestOverall) {
      pages.push({ rows: [], usedHeightMm: 0 });
      const newPageIndex = pages.length - 1;
      const candidate = pickBestCandidateForPage(item, pages[newPageIndex], newPageIndex);
      if (!candidate) throw new StickerDoesNotFitError();
      bestOverall = candidate;
    }

    placeUsingCandidate(item, bestOverall);
  }

  const totalPages = Math.max(1, pages.length);
  return { placements, totalPlaced: placements.length, totalPages };
}
