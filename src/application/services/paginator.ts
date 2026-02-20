import { Placement, SheetSpec, GridLayout } from "../../domain/models";

export interface AssetQty {
  assetId: string;
  qty: number;
}

export interface PaginationResult {
  placements: Placement[];
  totalPlaced: number;
  totalPages: number;
}

export function paginateByBlocks(params: {
  sheet: SheetSpec;
  layout: GridLayout;
  assets: AssetQty[]; // en orden (bloques)
}): PaginationResult {
  const { sheet, layout, assets } = params;

  const placements: Placement[] = [];
  let placedTotal = 0;

  const placeOne = (assetId: string) => {
    const idxOnPage = placedTotal % layout.capacityPerPage;

    const r = Math.floor(idxOnPage / layout.cols);
    const c = idxOnPage % layout.cols;

    const xMm = sheet.marginMm + c * layout.stepXmm;

    // y crece hacia arriba; calculamos desde el borde superior del pliego
    const yTopMm = sheet.sheetHmm - sheet.marginMm - r * layout.stepYmm;
    const yMm = yTopMm - layout.stickerHmm;

    const pageIndex = Math.floor(placedTotal / layout.capacityPerPage);

    placements.push({ pageIndex, xMm, yMm, assetId });
    placedTotal += 1;
  };

  for (const a of assets) {
    const qty = Math.max(0, Math.trunc(a.qty));
    for (let i = 0; i < qty; i++) placeOne(a.assetId);
  }

  const totalPages = Math.max(1, Math.ceil(placedTotal / layout.capacityPerPage));

  return { placements, totalPlaced: placedTotal, totalPages };
}