import { InvalidSpecError } from "../errors";

export type Mm = number;
export type Px = number;
export type ExecutionSpecVersion = 1 | 2 | 3;

export interface ExecutionSpecSheet {
  wCm: number;
  hCm: number;
  gapMm: number;
  marginMm: number;
}

export type StickerSizing =
  | { mode: "physical"; wCm: number; hCm: number }
  | { mode: "fromImageDpi" }
  | { mode: "perAsset" };

export type AssetSizing =
  | { mode: "physical"; axis: "w"; sizeCm: number }
  | { mode: "physical"; axis: "h"; sizeCm: number }
  | { mode: "fromImageDpi" };

export interface ExecutionSpecItem {
  assetId: string;
  qty: number;
  sizing?: AssetSizing;
}

export interface ExecutionSpec {
  specVersion: ExecutionSpecVersion;
  timestamp: string; // ISO sin ms
  folderPath: string;
  dpi: number;
  sheet: ExecutionSpecSheet;
  stickerSizing: StickerSizing;
  quantities: ExecutionSpecItem[];
  algoVersion: string;
}

export const DEFAULT_EXECUTION_SPEC_VERSION: ExecutionSpecVersion = 3;
export const ALGO_GRID_V1 = "imposer-v1";
export const ALGO_SHELF_MIXED_V1 = "imposer-mixed-v1";
export const DEFAULT_ALGO_VERSION = ALGO_GRID_V1;
export const DEFAULT_DPI = 300;
export function defaultExecutionSheet(): ExecutionSpecSheet {
  return { wCm: 100, hCm: 50, gapMm: 3, marginMm: 0 };
}
export function defaultStickerSizing(): StickerSizing {
  return { mode: "physical", wCm: 6, hCm: 6 };
}

export interface SheetSpec {
  sheetWmm: Mm;     // ancho total del pliego
  sheetHmm: Mm;     // alto total del pliego
  gapMm: Mm;        // separación entre stickers
  marginMm: Mm;     // margen exterior
}

export interface StickerSpec {
  widthPx: Px;
  heightPx: Px;
  dpi: number;      // forzado 300 en tu caso
}

export interface GridLayout {
  cols: number;
  rows: number;
  capacityPerPage: number;

  stickerWmm: Mm;
  stickerHmm: Mm;

  stepXmm: Mm; // stickerW + gap
  stepYmm: Mm; // stickerH + gap
}

export interface Placement {
  pageIndex: number;  // 0-based
  xMm: Mm;            // esquina inferior izquierda del sticker
  yMm: Mm;
  assetId: string;    // nombre/id del PNG
  wMm: Mm;
  hMm: Mm;
}

export interface ImpositionJob {
  sheet: SheetSpec;
  sticker?: StickerSpec;
  layout?: GridLayout;
  assets: Array<{ assetId: string; qty: number }>;
  placements: Placement[];
  engineId: string;
}

export function cmToMm(cm: number): Mm {
  return cm * 10;
}

export function pxToMm(px: Px, dpi: number): Mm {
  if (!dpi || dpi <= 0) throw new InvalidSpecError("DPI inválido.");
  return (px / dpi) * 25.4;
}

export function createSheetSpec(params: {
  sheetWcm: number;
  sheetHcm: number;
  gapMm: number;
  marginMm: number;
}): SheetSpec {
  const sheetWmm = cmToMm(params.sheetWcm);
  const sheetHmm = cmToMm(params.sheetHcm);

  if (sheetWmm <= 0 || sheetHmm <= 0) throw new InvalidSpecError("El pliego debe ser > 0.");
  if (params.gapMm < 0) throw new InvalidSpecError("gapMm no puede ser negativo.");
  if (params.marginMm < 0) throw new InvalidSpecError("marginMm no puede ser negativo.");

  return { sheetWmm, sheetHmm, gapMm: params.gapMm, marginMm: params.marginMm };
}

export function createStickerSpec(params: { widthPx: number; heightPx: number; dpi: number }): StickerSpec {
  if (params.widthPx <= 0 || params.heightPx <= 0) throw new InvalidSpecError("El sticker debe tener px > 0.");
  if (!params.dpi || params.dpi <= 0) throw new InvalidSpecError("DPI inválido.");
  return { widthPx: params.widthPx, heightPx: params.heightPx, dpi: params.dpi };
}
