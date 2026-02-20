import { MixedStickerSizesError } from "../../domain/errors";
import { createSheetSpec, createStickerSpec, ImpositionJob } from "../../domain/models";
import { planGrid } from "../services/gridPlanner";
import { paginateByBlocks } from "../services/paginator";
import { CatalogPort, PngAssetInfo } from "../ports";

export interface ImposeFolderParams {
  folderPath: string;
  sheetWcm?: number;   // default 100
  sheetHcm?: number;   // default 50
  gapMm?: number;      // default 3
  marginMm?: number;   // default 0
  dpi?: number;        // default 300 (FORZADO)
  quantities: Array<{ assetId: string; qty: number }>;
  catalog: CatalogPort;
}

export interface ImposeFolderResult {
  job: ImpositionJob;
  assets: PngAssetInfo[];
  totalPlaced: number;
  totalPages: number;
}

export async function imposeFolder(params: ImposeFolderParams): Promise<ImposeFolderResult> {
  const sheet = createSheetSpec({
    sheetWcm: params.sheetWcm ?? 100,
    sheetHcm: params.sheetHcm ?? 50,
    gapMm: params.gapMm ?? 3,
    marginMm: params.marginMm ?? 0,
  });

  const dpi = params.dpi ?? 300;

  const assets = await params.catalog.listPngAssets(params.folderPath);
  if (assets.length === 0) throw new Error("No se encontraron PNGs en la carpeta.");

  // Validar tamaño homogéneo
  const ref = assets[0];
  for (const a of assets) {
    if (a.widthPx !== ref.widthPx || a.heightPx !== ref.heightPx) {
      throw new MixedStickerSizesError(
        `Tamaños distintos detectados: ${ref.assetId}=${ref.widthPx}x${ref.heightPx}px vs ${a.assetId}=${a.widthPx}x${a.heightPx}px`
      );
    }
  }

  const sticker = createStickerSpec({ widthPx: ref.widthPx, heightPx: ref.heightPx, dpi });
  const layout = planGrid(sheet, sticker);

  const pagination = paginateByBlocks({
    sheet,
    layout,
    assets: params.quantities.map((q) => ({ assetId: q.assetId, qty: q.qty })),
  });

  const job: ImpositionJob = {
    sheet,
    sticker,
    layout,
    assets: params.quantities,
    placements: pagination.placements,
  };

  return {
    job,
    assets,
    totalPlaced: pagination.totalPlaced,
    totalPages: pagination.totalPages,
  };
}