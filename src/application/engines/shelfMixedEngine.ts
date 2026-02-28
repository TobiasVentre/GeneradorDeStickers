import { ALGO_SHELF_MIXED_V1, pxToMm } from "../../domain/models";
import { paginateByShelf } from "../services/shelfPlanner";
import type { AssetSizing, ImpositionJob } from "../../domain/models";
import type { PngAssetInfo } from "../ports";
import type { EnginePlanParams, EnginePlanResult, ImpositionEngine } from "./index";

function resolveAssetSizing(params: {
  sizing: AssetSizing;
  widthPx: number;
  heightPx: number;
  dpi: number;
}): { widthMm: number; heightMm: number; effectiveDpi: number } {
  const { sizing, widthPx, heightPx, dpi } = params;

  if (sizing.mode === "fromImageDpi") {
    const widthMm = pxToMm(widthPx, dpi);
    const heightMm = pxToMm(heightPx, dpi);
    return { widthMm, heightMm, effectiveDpi: dpi };
  }

  const ratio = widthPx / heightPx;
  const sizeMm = sizing.sizeCm * 10;

  if (sizing.axis === "w") {
    const widthMm = sizeMm;
    const heightMm = widthMm / ratio;
    const effectiveDpi = (widthPx * 25.4) / widthMm;
    return { widthMm, heightMm, effectiveDpi };
  }

  const heightMm = sizeMm;
  const widthMm = heightMm * ratio;
  const effectiveDpi = (widthPx * 25.4) / widthMm;
  return { widthMm, heightMm, effectiveDpi };
}

function buildAssetMap(assets: PngAssetInfo[]): Map<string, PngAssetInfo> {
  return new Map(assets.map((a) => [a.assetId, a]));
}

export class ShelfMixedImpositionEngine implements ImpositionEngine {
  readonly id = ALGO_SHELF_MIXED_V1;

  plan(params: EnginePlanParams): EnginePlanResult {
    const { spec, assets, sheet } = params;

    if (spec.stickerSizing?.mode !== "perAsset") {
      throw new Error("El motor mixed requiere stickerSizing.mode=perAsset.");
    }

    const byId = buildAssetMap(assets);
    const sizedAssets = spec.quantities.map((q) => {
      const info = byId.get(q.assetId);
      if (!info) throw new Error(`Falta PNG para assetId=${q.assetId}`);
      if (!q.sizing) {
        throw new Error(`Falta sizing para assetId=${q.assetId}.`);
      }
      const resolved = resolveAssetSizing({
        sizing: q.sizing,
        widthPx: info.widthPx,
        heightPx: info.heightPx,
        dpi: spec.dpi,
      });
      return { assetId: q.assetId, qty: q.qty, wMm: resolved.widthMm, hMm: resolved.heightMm };
    });

    const pagination = paginateByShelf({
      sheet,
      assets: sizedAssets,
    });

    const job: ImpositionJob = {
      sheet,
      assets: spec.quantities.map((q) => ({ assetId: q.assetId, qty: q.qty })),
      placements: pagination.placements,
      engineId: this.id,
    };

    return {
      job,
      totalPlaced: pagination.totalPlaced,
      totalPages: pagination.totalPages,
    };
  }
}
