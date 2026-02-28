import { MixedStickerSizesError } from "../../domain/errors";
import {
  ALGO_GRID_V1,
  StickerSizing,
  createStickerSpec,
  defaultStickerSizing,
  pxToMm,
} from "../../domain/models";
import { planGrid } from "../services/gridPlanner";
import { paginateByBlocks } from "../services/paginator";
import type { ImpositionJob } from "../../domain/models";
import type { PngAssetInfo } from "../ports";
import type { EnginePlanParams, EnginePlanResult, ImpositionEngine } from "./index";

function resolveStickerSizing(params: {
  sizing: StickerSizing;
  widthPx: number;
  heightPx: number;
  dpi: number;
}): { widthMm: number; heightMm: number; effectiveDpi: number } {
  const { sizing, widthPx, heightPx, dpi } = params;

  if (sizing.mode === "physical") {
    if (sizing.wCm <= 0 || sizing.hCm <= 0) {
      throw new Error("Sticker fisico invalido: wCm/hCm deben ser > 0.");
    }
    const widthMm = sizing.wCm * 10;
    const heightMm = sizing.hCm * 10;
    const effectiveDpi = (widthPx * 25.4) / widthMm;
    return { widthMm, heightMm, effectiveDpi };
  }

  if (sizing.mode === "perAsset") {
    throw new Error("Sticker sizing per-asset no es compatible con el motor de grilla.");
  }

  const widthMm = pxToMm(widthPx, dpi);
  const heightMm = pxToMm(heightPx, dpi);
  return { widthMm, heightMm, effectiveDpi: dpi };
}

function maybeWarnSizing(params: {
  sizing: StickerSizing;
  widthPx: number;
  heightPx: number;
  effectiveDpi: number;
}): void {
  const { sizing, widthPx, heightPx, effectiveDpi } = params;

  if (sizing.mode === "physical") {
    const imageRatio = widthPx / heightPx;
    const physicalRatio = sizing.wCm / sizing.hCm;
    const diff = Math.abs(imageRatio - physicalRatio) / physicalRatio;
    if (diff > 0.01) {
      console.warn(
        `Advertencia: el ratio del PNG (${imageRatio.toFixed(4)}) difiere del tamano fisico (${physicalRatio.toFixed(
          4
        )}) en mas de 1%.`
      );
    }
    return;
  }

  if (effectiveDpi < 250) {
    console.warn(`Advertencia: DPI efectivo bajo (${effectiveDpi.toFixed(1)}).`);
  }
}

function assertUniformAssetSize(assets: PngAssetInfo[]): void {
  if (assets.length === 0) return;
  const ref = assets[0];
  for (const a of assets) {
    if (a.widthPx !== ref.widthPx || a.heightPx !== ref.heightPx) {
      throw new MixedStickerSizesError(
        `Tamanos distintos detectados: ${ref.assetId}=${ref.widthPx}x${ref.heightPx}px vs ${a.assetId}=${a.widthPx}x${a.heightPx}px`
      );
    }
  }
}

export class GridImpositionEngine implements ImpositionEngine {
  readonly id = ALGO_GRID_V1;

  plan(params: EnginePlanParams): EnginePlanResult {
    const { spec, assets, sheet } = params;

    assertUniformAssetSize(assets);

    const ref = assets[0];
    if (!ref) {
      throw new Error("No se encontraron PNGs en la carpeta.");
    }

    const sizing = spec.stickerSizing ?? defaultStickerSizing();
    const resolved = resolveStickerSizing({
      sizing,
      widthPx: ref.widthPx,
      heightPx: ref.heightPx,
      dpi: spec.dpi,
    });

    maybeWarnSizing({
      sizing,
      widthPx: ref.widthPx,
      heightPx: ref.heightPx,
      effectiveDpi: resolved.effectiveDpi,
    });

    const sticker = createStickerSpec({
      widthPx: ref.widthPx,
      heightPx: ref.heightPx,
      dpi: resolved.effectiveDpi,
    });
    const layout = planGrid(sheet, sticker);

    const pagination = paginateByBlocks({
      sheet,
      layout,
      assets: spec.quantities.map((q) => ({ assetId: q.assetId, qty: q.qty })),
    });

    const job: ImpositionJob = {
      sheet,
      sticker,
      layout,
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
