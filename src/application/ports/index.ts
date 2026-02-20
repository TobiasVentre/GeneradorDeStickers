import type { ImpositionJob } from "../../domain/models";

// ===== Catalog (leer PNGs desde FS, etc.) =====
export interface PngAssetInfo {
  assetId: string;   // ej: "1.png"
  filePath: string;  // ruta completa
  widthPx: number;
  heightPx: number;
}

export interface CatalogPort {
  listPngAssets(folderPath: string): Promise<PngAssetInfo[]>;
}

// ===== Renderer (PDF, etc.) =====
export interface RenderPdfOptions {
  drawBoxes?: boolean;
  crosshair?: boolean;
}

export interface RendererPort {
  renderPdf(params: {
    job: ImpositionJob;
    assetPathById: Record<string, string>;
    outputPath: string;
    options?: RenderPdfOptions;
  }): Promise<void>;
}
export interface ExecutionSummary {
  timestamp: string;
  folderPath: string;
  outputPdfPath: string;

  sheetWcm: number;
  sheetHcm: number;
  gapMm: number;
  marginMm: number;
  dpi: number;

  capacityPerPage: number;
  totalPlaced: number;
  totalPages: number;

  items: Array<{ assetId: string; qty: number }>;
}

export interface OrderWriterPort {
  writeExecutionCsv(params: { csvPath: string; summary: ExecutionSummary }): Promise<void>;
}