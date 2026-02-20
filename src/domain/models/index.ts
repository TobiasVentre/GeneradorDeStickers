import { InvalidSpecError } from "../errors";

export type Mm = number;
export type Px = number;

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
}

export interface ImpositionJob {
  sheet: SheetSpec;
  sticker: StickerSpec;
  layout: GridLayout;
  assets: Array<{ assetId: string; qty: number }>;
  placements: Placement[];
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