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
  let placedTotal = 0;

  const usableW = sheet.sheetWmm - 2 * sheet.marginMm;
  const usableH = sheet.sheetHmm - 2 * sheet.marginMm;

  const maxX = sheet.sheetWmm - sheet.marginMm;

  let pageIndex = 0;
  let x = sheet.marginMm;
  let yTop = sheet.sheetHmm - sheet.marginMm;
  let rowHeight = 0;

  const placeOne = (assetId: string, wMm: number, hMm: number) => {
    if (wMm > usableW || hMm > usableH) {
      throw new StickerDoesNotFitError();
    }

    if (x + wMm > maxX) {
      x = sheet.marginMm;
      yTop = yTop - rowHeight - sheet.gapMm;
      rowHeight = 0;
    }

    if (yTop - hMm < sheet.marginMm) {
      pageIndex += 1;
      x = sheet.marginMm;
      yTop = sheet.sheetHmm - sheet.marginMm;
      rowHeight = 0;
    }

    if (yTop - hMm < sheet.marginMm) {
      throw new StickerDoesNotFitError();
    }

    const yMm = yTop - hMm;
    placements.push({ pageIndex, xMm: x, yMm, assetId, wMm, hMm });
    placedTotal += 1;

    x += wMm + sheet.gapMm;
    rowHeight = Math.max(rowHeight, hMm);
  };

  for (const a of assets) {
    const qty = Math.max(0, Math.trunc(a.qty));
    for (let i = 0; i < qty; i++) placeOne(a.assetId, a.wMm, a.hMm);
  }

  const totalPages = Math.max(1, pageIndex + 1);
  return { placements, totalPlaced: placedTotal, totalPages };
}
