import { StickerDoesNotFitError, InvalidSpecError } from "../../domain/errors";
import { GridLayout, SheetSpec, StickerSpec, pxToMm } from "../../domain/models";

export function planGrid(sheet: SheetSpec, sticker: StickerSpec): GridLayout {
  const stickerWmm = pxToMm(sticker.widthPx, sticker.dpi);
  const stickerHmm = pxToMm(sticker.heightPx, sticker.dpi);

  const usableW = sheet.sheetWmm - 2 * sheet.marginMm;
  const usableH = sheet.sheetHmm - 2 * sheet.marginMm;

  if (usableW <= 0 || usableH <= 0) throw new InvalidSpecError("El margen deja el área útil en 0 o negativa.");

  const stepXmm = stickerWmm + sheet.gapMm;
  const stepYmm = stickerHmm + sheet.gapMm;

  // misma lógica que en Python: +gap para contemplar el último sticker sin gap extra
  const cols = Math.floor((usableW + sheet.gapMm) / stepXmm);
  const rows = Math.floor((usableH + sheet.gapMm) / stepYmm);

  if (cols <= 0 || rows <= 0) throw new StickerDoesNotFitError();

  return {
    cols,
    rows,
    capacityPerPage: cols * rows,
    stickerWmm,
    stickerHmm,
    stepXmm,
    stepYmm,
  };
}