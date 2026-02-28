import type { ExecutionSpec, ImpositionJob } from "../../domain/models";

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
export interface OrderWriterPort {
  writeExecutionCsv(params: { csvPath: string; spec: ExecutionSpec }): Promise<void>;
}
