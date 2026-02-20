import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { RendererPort, RenderPdfOptions } from "../../application/ports";
import type { ImpositionJob } from "../../domain/models";

const mmToPt = (mm: number) => (mm * 72) / 25.4;

export class PdfLibRenderer implements RendererPort {
  async renderPdf(params: {
    job: ImpositionJob;
    assetPathById: Record<string, string>;
    outputPath: string;
    options?: RenderPdfOptions;
  }): Promise<void> {
    const { job, assetPathById, outputPath } = params;
    const options = params.options ?? {};

    const doc = await PDFDocument.create();

    const pageW = mmToPt(job.sheet.sheetWmm);
    const pageH = mmToPt(job.sheet.sheetHmm);

    const maxPageIndex = job.placements.reduce((m, p) => Math.max(m, p.pageIndex), 0);
    const pages = Array.from({ length: maxPageIndex + 1 }, () => doc.addPage([pageW, pageH]));

    // Cache de imágenes embebidas
    const imageCache = new Map<string, any>();

    const getEmbeddedPng = async (assetId: string) => {
      const cached = imageCache.get(assetId);
      if (cached) return cached;

      const path = assetPathById[assetId];
      if (!path) throw new Error(`No tengo filepath para assetId=${assetId}`);

      // Normalizamos PNG (evita paleta/indexado raro; maneja alpha mejor)
      // Si querés forzar fondo blanco: .flatten({ background: "#FFFFFF" })
      const normalizedPngBytes = await sharp(path).png().toBuffer();

      const img = await doc.embedPng(normalizedPngBytes);
      imageCache.set(assetId, img);
      return img;
    };

    const drawBoxLines = (page: any, x: number, y: number, w: number, h: number) => {
      // 4 líneas = marco, sin riesgo de fill negro
      page.drawLine({ start: { x, y }, end: { x: x + w, y } });
      page.drawLine({ start: { x, y }, end: { x, y: y + h } });
      page.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y + h } });
      page.drawLine({ start: { x, y: y + h }, end: { x: x + w, y: y + h } });
    };

    const drawCrosshair = (page: any, x: number, y: number, w: number, h: number) => {
      const len = mmToPt(4);
      const inset = mmToPt(1);

      const corners = [
        { cx: x, cy: y },         // bottom-left
        { cx: x + w, cy: y },     // bottom-right
        { cx: x, cy: y + h },     // top-left
        { cx: x + w, cy: y + h }, // top-right
      ];

      for (const c of corners) {
        // horizontal
        if (c.cx === x) {
          page.drawLine({ start: { x: c.cx - len, y: c.cy }, end: { x: c.cx - inset, y: c.cy } });
        } else {
          page.drawLine({ start: { x: c.cx + inset, y: c.cy }, end: { x: c.cx + len, y: c.cy } });
        }
        // vertical
        if (c.cy === y) {
          page.drawLine({ start: { x: c.cx, y: c.cy - len }, end: { x: c.cx, y: c.cy - inset } });
        } else {
          page.drawLine({ start: { x: c.cx, y: c.cy + inset }, end: { x: c.cx, y: c.cy + len } });
        }
      }
    };

    const stickerW = mmToPt(job.layout.stickerWmm);
    const stickerH = mmToPt(job.layout.stickerHmm);

    for (const placement of job.placements) {
      const page = pages[placement.pageIndex];

      const x = mmToPt(placement.xMm);
      const y = mmToPt(placement.yMm);

      const embedded = await getEmbeddedPng(placement.assetId);
      page.drawImage(embedded, { x, y, width: stickerW, height: stickerH });

      if (options.drawBoxes) drawBoxLines(page, x, y, stickerW, stickerH);
      if (options.crosshair) drawCrosshair(page, x, y, stickerW, stickerH);
    }

    const pdfBytes = await doc.save();
    await writeFile(outputPath, pdfBytes);
  }
}