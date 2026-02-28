import "./styles.css";
import { PDFDocument, PDFImage, PDFPage, degrees, rgb } from "pdf-lib";
import { imposeFromSpec } from "@core/application/usecases";
import type { CatalogPort, PngAssetInfo } from "@core/application/ports";
import {
  ALGO_GRID_V1,
  ALGO_SHELF_MIXED_V1,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  type ExecutionSpec,
  type ExecutionSpecItem,
  type ImpositionJob,
  defaultExecutionSheet,
} from "@core/domain/models";

type LoadedAsset = PngAssetInfo & {
  file: File;
  objectUrl: string;
};

type GeneratedArtifacts = {
  spec: ExecutionSpec;
  job: ImpositionJob;
  totalPages: number;
  totalPlaced: number;
  occupancyAvgPct: number;
  occupancyByPagePct: number[];
  pdfBytes: Uint8Array;
  csvText: string;
};

type CutMode = "none" | "real" | "simple";
type CutOptions = {
  mode: CutMode;
  offsetMm: number;
};

type WatermarkOptions = {
  file: File | null;
};

type Corner = "tl" | "tr" | "bl" | "br";

class BrowserCatalog implements CatalogPort {
  constructor(private readonly assets: PngAssetInfo[]) {}

  async listPngAssets(_folderPath: string): Promise<PngAssetInfo[]> {
    return this.assets;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontro #app");

const baseSheetDefaults = defaultExecutionSheet();
const sheetDefaults = {
  wCm: baseSheetDefaults.hCm,
  hCm: baseSheetDefaults.wCm,
  gapMm: baseSheetDefaults.gapMm,
  marginMm: baseSheetDefaults.marginMm,
};

const state: {
  assets: LoadedAsset[];
  qtyById: Map<string, number>;
  sizeAxisById: Map<string, "w" | "h">;
  sizeCmById: Map<string, number>;
  watermarkFile: File | null;
  watermarkUrl: string | null;
  watermarkImage: HTMLImageElement | null;
  generated: GeneratedArtifacts | null;
  previewPage: number;
  imageById: Map<string, HTMLImageElement>;
} = {
  assets: [],
  qtyById: new Map<string, number>(),
  sizeAxisById: new Map<string, "w" | "h">(),
  sizeCmById: new Map<string, number>(),
  watermarkFile: null,
  watermarkUrl: null,
  watermarkImage: null,
  generated: null,
  previewPage: 0,
  imageById: new Map<string, HTMLImageElement>(),
};

app.innerHTML = `
  <main class="layout">
    <section class="panel controls">
      <h1>Sticker Imposer</h1>
      <p class="subtle">UI web local para armar PDF + CSV con preview.</p>

      <label class="block">
        Cargar PNGs (archivos)
        <input id="filesInput" type="file" accept=".png,image/png" multiple />
      </label>
      <label class="block">
        Cargar carpeta PNGs
        <input id="folderInput" type="file" accept=".png,image/png" webkitdirectory directory multiple />
      </label>
      <div id="dropZone" class="drop-zone">Solta PNGs aca</div>

      <div class="grid two">
        <label class="block">
          Motor
          <select id="engineSelect">
            <option value="${ALGO_GRID_V1}">${ALGO_GRID_V1}</option>
            <option value="${ALGO_SHELF_MIXED_V1}">${ALGO_SHELF_MIXED_V1}</option>
          </select>
        </label>
        <label class="block">
          Ajustar por
          <select id="sizeAxisInput">
            <option value="w">Ancho</option>
            <option value="h">Alto</option>
          </select>
        </label>
      </div>
      <label class="block">
        Tamano objetivo (cm)
        <input id="sizeCmInput" type="number" min="0.1" step="0.1" value="6" />
      </label>
      <div class="grid two">
        <label class="block">
          Linea de corte
          <select id="cutModeSelect">
            <option value="none">Sin corte</option>
            <option value="real" selected>Contorno real PNG</option>
            <option value="simple">Contorno simplificado</option>
          </select>
        </label>
        <label class="block">
          Offset corte (mm)
          <input id="cutOffsetInput" type="number" min="0" step="0.1" value="3" />
        </label>
      </div>
      <label class="block">
        Marca de agua (SVG o PNG)
        <input id="watermarkInput" type="file" accept=".svg,image/svg+xml,.png,image/png" />
      </label>

      <div class="grid two">
        <label class="block">Ancho pliego (cm)<input id="sheetWInput" type="number" min="1" value="${sheetDefaults.wCm}" /></label>
        <label class="block">Alto pliego (cm)<input id="sheetHInput" type="number" min="1" value="${sheetDefaults.hCm}" /></label>
        <label class="block">Gap (mm)<input id="gapInput" type="number" min="0" value="${sheetDefaults.gapMm}" /></label>
        <label class="block">Margen (mm)<input id="marginInput" type="number" min="0" value="${sheetDefaults.marginMm}" /></label>
      </div>

      <h2>Assets y cantidades</h2>
      <div class="assets-toolbar">
        <span class="subtle">Alto tabla</span>
        <div class="assets-size-actions">
          <button id="shrinkAssetsBtn" type="button">-</button>
          <button id="growAssetsBtn" type="button">+</button>
          <button id="resetAssetsBtn" type="button">Reset</button>
        </div>
      </div>
      <div id="assetsWrap" class="assets-wrap">
        <p class="subtle">Todavia no hay PNGs cargados.</p>
      </div>

      <button id="generateBtn" class="primary">Generar PDF + CSV</button>
      <p id="status" class="status subtle"></p>

      <div id="downloadActions" class="downloads hidden">
        <button id="downloadPdfBtn">Descargar PDF</button>
        <button id="downloadCsvBtn">Descargar CSV</button>
      </div>
    </section>

    <section class="panel preview">
      <div class="preview-head">
        <h2>Preview</h2>
        <div class="preview-controls">
          <button id="prevPageBtn">Anterior</button>
          <span id="pageLabel">Pagina -/-</span>
          <button id="nextPageBtn">Siguiente</button>
        </div>
      </div>
      <canvas id="previewCanvas"></canvas>
      <p id="summary" class="subtle">Genera un trabajo para ver el armado.</p>
    </section>
  </main>
`;

const filesInput = mustElement<HTMLInputElement>("filesInput");
const folderInput = mustElement<HTMLInputElement>("folderInput");
const dropZone = mustElement<HTMLDivElement>("dropZone");
const engineSelect = mustElement<HTMLSelectElement>("engineSelect");
const sizeAxisInput = mustElement<HTMLSelectElement>("sizeAxisInput");
const sizeCmInput = mustElement<HTMLInputElement>("sizeCmInput");
const cutModeSelect = mustElement<HTMLSelectElement>("cutModeSelect");
const cutOffsetInput = mustElement<HTMLInputElement>("cutOffsetInput");
const watermarkInput = mustElement<HTMLInputElement>("watermarkInput");
const sheetWInput = mustElement<HTMLInputElement>("sheetWInput");
const sheetHInput = mustElement<HTMLInputElement>("sheetHInput");
const gapInput = mustElement<HTMLInputElement>("gapInput");
const marginInput = mustElement<HTMLInputElement>("marginInput");
const assetsWrap = mustElement<HTMLDivElement>("assetsWrap");
const shrinkAssetsBtn = mustElement<HTMLButtonElement>("shrinkAssetsBtn");
const growAssetsBtn = mustElement<HTMLButtonElement>("growAssetsBtn");
const resetAssetsBtn = mustElement<HTMLButtonElement>("resetAssetsBtn");
const generateBtn = mustElement<HTMLButtonElement>("generateBtn");
const statusLine = mustElement<HTMLParagraphElement>("status");
const downloadActions = mustElement<HTMLDivElement>("downloadActions");
const downloadPdfBtn = mustElement<HTMLButtonElement>("downloadPdfBtn");
const downloadCsvBtn = mustElement<HTMLButtonElement>("downloadCsvBtn");
const previewCanvas = mustElement<HTMLCanvasElement>("previewCanvas");
const summary = mustElement<HTMLParagraphElement>("summary");
const prevPageBtn = mustElement<HTMLButtonElement>("prevPageBtn");
const nextPageBtn = mustElement<HTMLButtonElement>("nextPageBtn");
const pageLabel = mustElement<HTMLSpanElement>("pageLabel");

const resizeObserver = new ResizeObserver(() => drawPreview());
resizeObserver.observe(previewCanvas);

filesInput.addEventListener("change", () => void importFiles(filesInput.files));
folderInput.addEventListener("change", () => void importFiles(folderInput.files));
engineSelect.addEventListener("change", () => renderAssetsTable());
watermarkInput.addEventListener("change", () => onWatermarkSelected(watermarkInput.files));
cutModeSelect.addEventListener("change", () => drawPreview());
cutOffsetInput.addEventListener("change", () => drawPreview());
shrinkAssetsBtn.addEventListener("click", () => resizeAssetsWrap(-60));
growAssetsBtn.addEventListener("click", () => resizeAssetsWrap(60));
resetAssetsBtn.addEventListener("click", () => setAssetsWrapHeight(280));
generateBtn.addEventListener("click", () => void generate());
downloadPdfBtn.addEventListener("click", () => downloadPdf());
downloadCsvBtn.addEventListener("click", () => downloadCsv());
prevPageBtn.addEventListener("click", () => movePage(-1));
nextPageBtn.addEventListener("click", () => movePage(1));

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("active");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("active"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("active");
  void importFiles(event.dataTransfer?.files ?? null);
});

function mustElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No se encontro #${id}`);
  return el as T;
}

async function importFiles(fileList: FileList | null): Promise<void> {
  if (!fileList) return;
  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".png"));
  if (files.length === 0) {
    setStatus("No se detectaron PNGs.");
    return;
  }

  for (const old of state.assets) {
    URL.revokeObjectURL(old.objectUrl);
  }
  state.assets = [];
  state.qtyById.clear();
  state.sizeAxisById.clear();
  state.sizeCmById.clear();
  state.generated = null;
  state.previewPage = 0;
  state.imageById.clear();
  renderDownloadActions();

  setStatus("Leyendo dimensiones...");
  const loaded = await Promise.all(files.map((f) => toLoadedAsset(f)));
  loaded.sort((a, b) => a.assetId.localeCompare(b.assetId));

  for (const a of loaded) {
    state.assets.push(a);
    state.qtyById.set(a.assetId, 1);
    state.sizeAxisById.set(a.assetId, "w");
    state.sizeCmById.set(a.assetId, 6);
    state.imageById.set(a.assetId, makeImage(a.objectUrl));
  }

  renderAssetsTable();
  drawPreview();
  setStatus(`Cargados ${state.assets.length} PNG(s).`);
}

function makeImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  return img;
}

async function toLoadedAsset(file: File): Promise<LoadedAsset> {
  const objectUrl = URL.createObjectURL(file);
  const { widthPx, heightPx } = await readDimensions(objectUrl);
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const assetId = rel && rel.trim() ? rel : file.name;
  return {
    assetId,
    filePath: assetId,
    widthPx,
    heightPx,
    file,
    objectUrl,
  };
}

function readDimensions(objectUrl: string): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    img.onerror = () => reject(new Error("No se pudo leer el PNG."));
    img.src = objectUrl;
  });
}

function renderAssetsTable(): void {
  if (state.assets.length === 0) {
    assetsWrap.innerHTML = `<p class="subtle">Todavia no hay PNGs cargados.</p>`;
    return;
  }
  const isMixed = engineSelect.value === ALGO_SHELF_MIXED_V1;

  assetsWrap.innerHTML = `
    <table class="assets-table ${isMixed ? "mixed" : ""}">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Px</th>
          <th>Cantidad</th>
          ${isMixed ? "<th>Ajustar por</th><th>Tamano (cm)</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${state.assets
          .map((asset) => {
            const value = state.qtyById.get(asset.assetId) ?? 0;
            const axis = state.sizeAxisById.get(asset.assetId) ?? "w";
            const sizeCm = state.sizeCmById.get(asset.assetId) ?? 6;
            return `
            <tr>
              <td title="${asset.assetId}">${escapeHtml(asset.assetId)}</td>
              <td>${asset.widthPx}x${asset.heightPx}</td>
              <td><input data-asset-id="${escapeHtml(asset.assetId)}" class="qty-input" type="number" min="0" value="${value}" /></td>
              ${
                isMixed
                  ? `<td>
                       <select data-asset-id="${escapeHtml(asset.assetId)}" class="axis-input">
                         <option value="w" ${axis === "w" ? "selected" : ""}>Ancho</option>
                         <option value="h" ${axis === "h" ? "selected" : ""}>Alto</option>
                       </select>
                     </td>
                     <td><input data-asset-id="${escapeHtml(asset.assetId)}" class="sizecm-input" type="number" min="0.1" step="0.1" value="${sizeCm}" /></td>`
                  : ""
              }
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  for (const input of Array.from(assetsWrap.querySelectorAll<HTMLInputElement>(".qty-input"))) {
    input.addEventListener("change", () => {
      const id = input.dataset.assetId ?? "";
      const value = Number.isFinite(input.valueAsNumber) ? Math.max(0, Math.trunc(input.valueAsNumber)) : 0;
      state.qtyById.set(id, value);
      if (input.value !== String(value)) input.value = String(value);
    });
  }

  for (const input of Array.from(assetsWrap.querySelectorAll<HTMLSelectElement>(".axis-input"))) {
    input.addEventListener("change", () => {
      const id = input.dataset.assetId ?? "";
      state.sizeAxisById.set(id, input.value === "h" ? "h" : "w");
    });
  }

  for (const input of Array.from(assetsWrap.querySelectorAll<HTMLInputElement>(".sizecm-input"))) {
    input.addEventListener("change", () => {
      const id = input.dataset.assetId ?? "";
      const value = toPositiveNumber(input.value, 6);
      state.sizeCmById.set(id, value);
      if (input.value !== String(value)) input.value = String(value);
    });
  }
}

function onWatermarkSelected(fileList: FileList | null): void {
  const file = fileList && fileList.length > 0 ? fileList[0] : null;
  if (state.watermarkUrl) {
    URL.revokeObjectURL(state.watermarkUrl);
    state.watermarkUrl = null;
  }
  state.watermarkFile = null;
  state.watermarkImage = null;
  if (!file || !isSupportedWatermarkFile(file)) {
    if (file) setStatus("La marca de agua debe ser SVG o PNG.");
    return;
  }
  const url = URL.createObjectURL(file);
  state.watermarkFile = file;
  state.watermarkUrl = url;
  state.watermarkImage = makeImage(url);
  setStatus(`Marca de agua cargada: ${file.name}`);
  drawPreview();
}

function isSupportedWatermarkFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".png") ||
    name.endsWith(".svg") ||
    file.type === "image/png" ||
    file.type === "image/svg+xml"
  );
}

function resizeAssetsWrap(deltaPx: number): void {
  const current = assetsWrap.getBoundingClientRect().height || 280;
  setAssetsWrapHeight(current + deltaPx);
}

function setAssetsWrapHeight(heightPx: number): void {
  const clamped = Math.min(640, Math.max(180, Math.round(heightPx)));
  assetsWrap.style.height = `${clamped}px`;
}

async function generate(): Promise<void> {
  if (state.assets.length === 0) {
    setStatus("Primero carga al menos un PNG.");
    return;
  }

  setStatus("Generando...");
  generateBtn.disabled = true;

  try {
    const spec = buildExecutionSpec();
    const cut = buildCutOptions();
    const watermark = buildWatermarkOptions();
    const catalog = new BrowserCatalog(state.assets);
    const result = await imposeFromSpec({ catalog, spec });
    const occupancy = computeOccupancy(result.job, result.totalPages);
    const pdfBytes = await renderPdfInBrowser(result.job, state.assets, cut, watermark);
    const csvText = toExecutionCsv(spec);

    state.generated = {
      spec,
      job: result.job,
      totalPages: result.totalPages,
      totalPlaced: result.totalPlaced,
      occupancyAvgPct: occupancy.averagePct,
      occupancyByPagePct: occupancy.byPagePct,
      pdfBytes,
      csvText,
    };
    state.previewPage = 0;
    renderDownloadActions();
    drawPreview();
    setSummary();
    setStatus("Listo. Puedes descargar PDF y CSV.");
  } catch (error) {
    setStatus((error as Error).message);
  } finally {
    generateBtn.disabled = false;
  }
}

function buildExecutionSpec(): ExecutionSpec {
  const sheetWcm = toPositiveNumber(sheetWInput.value, sheetDefaults.wCm);
  const sheetHcm = toPositiveNumber(sheetHInput.value, sheetDefaults.hCm);
  const gapMm = toNonNegativeNumber(gapInput.value, sheetDefaults.gapMm);
  const marginMm = toNonNegativeNumber(marginInput.value, sheetDefaults.marginMm);
  const dpi = DEFAULT_DPI;
  const algoVersion = engineSelect.value;
  const sizeCm = toPositiveNumber(sizeCmInput.value, 6);
  const sizeAxis = sizeAxisInput.value === "h" ? "h" : "w";

  const baseQuantities = state.assets.map<ExecutionSpecItem>((asset) => {
    const qty = state.qtyById.get(asset.assetId) ?? 0;
    return { assetId: asset.assetId, qty };
  });
  const quantities = baseQuantities.filter((q) => q.qty > 0);

  if (quantities.length === 0) {
    throw new Error("No hay cantidades > 0.");
  }

  if (algoVersion === ALGO_SHELF_MIXED_V1) {
    return {
      specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
      timestamp: nowIsoNoMs(),
      folderPath: "browser://selected-files",
      dpi,
      sheet: { wCm: sheetWcm, hCm: sheetHcm, gapMm, marginMm },
      stickerSizing: { mode: "perAsset" },
      quantities: quantities.map((q) => ({
        ...q,
        sizing: {
          mode: "physical",
          axis: state.sizeAxisById.get(q.assetId) ?? "w",
          sizeCm: state.sizeCmById.get(q.assetId) ?? 6,
        },
      })),
      algoVersion,
    };
  }

  const firstAsset = state.assets.find((a) => quantities.some((q) => q.assetId === a.assetId));
  if (!firstAsset) throw new Error("No se encontro un asset valido para calcular tamano.");
  const ratio = firstAsset.widthPx / firstAsset.heightPx;
  const stickerSizing =
    sizeAxis === "w" ? { mode: "physical" as const, wCm: sizeCm, hCm: sizeCm / ratio } : { mode: "physical" as const, wCm: sizeCm * ratio, hCm: sizeCm };

  return {
    specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
    timestamp: nowIsoNoMs(),
    folderPath: "browser://selected-files",
    dpi,
    sheet: { wCm: sheetWcm, hCm: sheetHcm, gapMm, marginMm },
    stickerSizing,
    quantities,
    algoVersion,
  };
}

function buildCutOptions(): CutOptions {
  const modeRaw = cutModeSelect.value;
  const mode: CutMode = modeRaw === "real" || modeRaw === "simple" ? modeRaw : "none";
  const offsetMm = toNonNegativeNumber(cutOffsetInput.value, 3);
  return { mode, offsetMm };
}

function buildWatermarkOptions(): WatermarkOptions {
  return { file: state.watermarkFile };
}

function nowIsoNoMs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toPositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const mmToPt = (mm: number): number => (mm * 72) / 25.4;

type Point = { x: number; y: number };

async function renderPdfInBrowser(
  job: ImpositionJob,
  assets: LoadedAsset[],
  cut: CutOptions,
  watermark: WatermarkOptions
): Promise<Uint8Array> {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const doc = await PDFDocument.create();
  const pageW = mmToPt(job.sheet.sheetWmm);
  const pageH = mmToPt(job.sheet.sheetHmm);
  const maxPageIndex = job.placements.reduce((m, p) => Math.max(m, p.pageIndex), -1);
  const pageCount = Math.max(maxPageIndex + 1, 1);
  const pages = Array.from({ length: pageCount }, () => doc.addPage([pageW, pageH]));
  const cache = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  const contourCache = new Map<string, Promise<Point[]>>();
  const cornerScoreCache = new Map<string, Promise<Record<Corner, number>>>();
  const watermarkEmbedded: PDFImage | null = watermark.file ? await embedWatermarkImage(doc, watermark.file) : null;

  const getEmbedded = async (assetId: string) => {
    const cached = cache.get(assetId);
    if (cached) return cached;
    const asset = byId.get(assetId);
    if (!asset) throw new Error(`No existe PNG para assetId=${assetId}`);
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    const embedded = await doc.embedPng(bytes);
    cache.set(assetId, embedded);
    return embedded;
  };

  for (const p of job.placements) {
    const page = pages[p.pageIndex];
    const png = await getEmbedded(p.assetId);
    const asset = byId.get(p.assetId);
    if (!asset) throw new Error(`No existe PNG para assetId=${p.assetId}`);
    const xPt = mmToPt(p.xMm);
    const yPt = mmToPt(p.yMm);
    const wPt = mmToPt(p.wMm);
    const hPt = mmToPt(p.hMm);
    if (p.rotate90) {
      page.drawImage(png, {
        x: xPt,
        y: yPt + hPt,
        width: hPt,
        height: wPt,
        rotate: degrees(-90),
      });
    } else {
      page.drawImage(png, {
        x: xPt,
        y: yPt,
        width: wPt,
        height: hPt,
      });
    }

    if (watermarkEmbedded) {
      const cornerScores = getCornerScoresCached(cornerScoreCache, asset, !!p.rotate90);
      drawStickerWatermark(page, watermarkEmbedded, p, cut, await cornerScores);
    }

    if (cut.mode === "none") continue;

    if (cut.mode === "simple") {
      drawSimpleCutLine(page, p.xMm, p.yMm, p.wMm, p.hMm, cut.offsetMm);
      continue;
    }

    const contourKey = `${asset.assetId}|${p.wMm.toFixed(3)}|${p.hMm.toFixed(3)}|${cut.offsetMm.toFixed(3)}|${p.rotate90 ? "r1" : "r0"}`;
    if (!contourCache.has(contourKey)) {
      contourCache.set(contourKey, buildRealContour(asset, p.wMm, p.hMm, cut.offsetMm, !!p.rotate90));
    }
    const contour = await contourCache.get(contourKey)!;
    drawRealCutLine(page, contour, p.xMm, p.yMm, p.wMm, p.hMm);
  }

  return await doc.save();
}

async function embedWatermarkImage(doc: PDFDocument, file: File): Promise<PDFImage> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const isSvg = name.endsWith(".svg") || type === "image/svg+xml";
  if (!isSvg) {
    return await doc.embedPng(new Uint8Array(await file.arrayBuffer()));
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(objectUrl);
    const width = Math.max(64, img.naturalWidth || 512);
    const height = Math.max(64, img.naturalHeight || 512);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo rasterizar SVG de marca de agua.");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/png");
    return await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo convertir canvas a blob."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

function getCornerScoresCached(
  cache: Map<string, Promise<Record<Corner, number>>>,
  asset: LoadedAsset,
  rotate90: boolean
): Promise<Record<Corner, number>> {
  const key = `${asset.assetId}|${rotate90 ? "r1" : "r0"}`;
  if (!cache.has(key)) {
    cache.set(key, computeCornerTransparency(asset, rotate90));
  }
  return cache.get(key)!;
}

function drawStickerWatermark(
  page: PDFPage,
  wm: PDFImage,
  p: ImpositionJob["placements"][number],
  cut: CutOptions,
  cornerScores: Record<Corner, number>
): void {
  void cut;
  const bestCorner = pickBestCorner(cornerScores);
  const targetMm = clamp(Math.min(p.wMm, p.hMm) * 0.1, 2.2, 5.2);
  const insetMm = clamp(targetMm * 0.28, 0.8, 1.6);

  const ratio = wm.width / wm.height;
  const wMm = ratio >= 1 ? targetMm : targetMm * ratio;
  const hMm = ratio >= 1 ? targetMm / ratio : targetMm;

  const boxXmm = bestCorner === "tr" || bestCorner === "br" ? p.xMm + p.wMm - targetMm - insetMm : p.xMm + insetMm;
  const boxYmm = bestCorner === "tl" || bestCorner === "tr" ? p.yMm + p.hMm - targetMm - insetMm : p.yMm + insetMm;

  const xMm = boxXmm + (targetMm - wMm) / 2;
  const yMm = boxYmm + (targetMm - hMm) / 2;

  page.drawImage(wm, {
    x: mmToPt(xMm),
    y: mmToPt(yMm),
    width: mmToPt(wMm),
    height: mmToPt(hMm),
    opacity: 0.45,
  });
}

async function computeCornerTransparency(asset: LoadedAsset, rotate90: boolean): Promise<Record<Corner, number>> {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { tl: 255, tr: 255, bl: 255, br: 255 };

  const bitmap = await createImageBitmap(asset.file);
  try {
    ctx.clearRect(0, 0, size, size);
    if (rotate90) {
      ctx.save();
      ctx.translate(0, size);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(bitmap, 0, 0, size, size);
    }
  } finally {
    bitmap.close();
  }

  const data = ctx.getImageData(0, 0, size, size).data;
  const q = Math.floor(size * 0.2);
  return {
    tl: avgAlpha(data, size, 0, 0, q, q),
    tr: avgAlpha(data, size, size - q, 0, q, q),
    bl: avgAlpha(data, size, 0, size - q, q, q),
    br: avgAlpha(data, size, size - q, size - q, q, q),
  };
}

function avgAlpha(data: Uint8ClampedArray, width: number, x0: number, y0: number, w: number, h: number): number {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      sum += data[(y * width + x) * 4 + 3];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 255;
}

function pickBestCorner(scores: Record<Corner, number>): Corner {
  const corners: Corner[] = ["tr", "tl", "br", "bl"];
  // Preferimos mayor alpha promedio para asegurar que la marca quede dentro del area recortada.
  corners.sort((a, b) => scores[b] - scores[a]);
  return corners[0];
}

function drawSimpleCutLine(
  page: PDFPage,
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  offsetMm: number
): void {
  const x = mmToPt(xMm - offsetMm);
  const y = mmToPt(yMm - offsetMm);
  const w = mmToPt(wMm + offsetMm * 2);
  const h = mmToPt(hMm + offsetMm * 2);
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(1, 0, 0),
    borderWidth: mmToPt(0.2),
    opacity: 1,
    borderOpacity: 1,
  });
}

function drawRealCutLine(
  page: PDFPage,
  contour: Point[],
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number
): void {
  if (contour.length < 2) return;
  for (let i = 0; i < contour.length; i += 1) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    page.drawLine({
      start: {
        x: mmToPt(xMm + (a.x / 1000) * wMm),
        y: mmToPt(yMm + (1 - a.y / 1000) * hMm),
      },
      end: {
        x: mmToPt(xMm + (b.x / 1000) * wMm),
        y: mmToPt(yMm + (1 - b.y / 1000) * hMm),
      },
      color: rgb(1, 0, 0),
      thickness: mmToPt(0.2),
      opacity: 1,
    });
  }
}

async function buildRealContour(asset: LoadedAsset, wMm: number, hMm: number, offsetMm: number, rotate90: boolean): Promise<Point[]> {
  const pxPerMm = 5;
  const maskW = Math.max(24, Math.min(1800, Math.round(wMm * pxPerMm)));
  const maskH = Math.max(24, Math.min(1800, Math.round(hMm * pxPerMm)));

  const canvas = document.createElement("canvas");
  canvas.width = maskW;
  canvas.height = maskH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const bitmap = await createImageBitmap(asset.file);
  try {
    ctx.clearRect(0, 0, maskW, maskH);
    if (rotate90) {
      ctx.save();
      ctx.translate(0, maskH);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0, maskH, maskW);
      ctx.restore();
    } else {
      ctx.drawImage(bitmap, 0, 0, maskW, maskH);
    }
  } finally {
    bitmap.close();
  }

  const imageData = ctx.getImageData(0, 0, maskW, maskH);
  const binary = alphaToBinary(imageData.data, maskW, maskH, 12);
  const radiusPx = Math.max(0, Math.round(offsetMm * pxPerMm));
  const expanded = radiusPx > 0 ? dilateBinaryMask(binary, maskW, maskH, radiusPx) : binary;
  const loop = extractLargestBoundaryLoop(expanded, maskW, maskH);
  if (loop.length === 0) return [];

  const normalized = loop.map((p) => ({
    x: (p.x / maskW) * 1000,
    y: (p.y / maskH) * 1000,
  }));

  const simplified = simplifyClosedPolyline(normalized, 1.1);
  const smoothed = chaikinSmoothClosedPolyline(simplified, 1);
  const reduced = downsampleClosedPolyline(smoothed, 900);
  return simplifyClosedPolyline(reduced, 0.45);
}

function alphaToBinary(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    out[i] = data[i * 4 + 3] > threshold ? 1 : 0;
  }
  return out;
}

function dilateBinaryMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const r2 = radius * radius;
  for (let y = 0; y < height; y += 1) {
    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      let found = 0;
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      for (let yy = yMin; yy <= yMax && !found; yy += 1) {
        const dy = yy - y;
        for (let xx = xMin; xx <= xMax; xx += 1) {
          const dx = xx - x;
          if (dx * dx + dy * dy > r2) continue;
          if (mask[yy * width + xx]) {
            found = 1;
            break;
          }
        }
      }
      out[y * width + x] = found;
    }
  }
  return out;
}

function extractLargestBoundaryLoop(mask: Uint8Array, width: number, height: number): Point[] {
  const edges = new Map<string, string[]>();
  const pushEdge = (sx: number, sy: number, ex: number, ey: number) => {
    const s = `${sx},${sy}`;
    const e = `${ex},${ey}`;
    const bucket = edges.get(s);
    if (bucket) bucket.push(e);
    else edges.set(s, [e]);
  };

  const isOn = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isOn(x, y)) continue;
      if (!isOn(x, y - 1)) pushEdge(x, y, x + 1, y);
      if (!isOn(x + 1, y)) pushEdge(x + 1, y, x + 1, y + 1);
      if (!isOn(x, y + 1)) pushEdge(x + 1, y + 1, x, y + 1);
      if (!isOn(x - 1, y)) pushEdge(x, y + 1, x, y);
    }
  }

  const visited = new Set<string>();
  const loops: Point[][] = [];

  for (const [start, nexts] of edges.entries()) {
    for (const next of nexts) {
      const edgeKey = `${start}->${next}`;
      if (visited.has(edgeKey)) continue;

      const loop: Point[] = [];
      let currentStart = start;
      let currentNext = next;
      let guard = 0;
      while (guard < 250000) {
        guard += 1;
        const [sx, sy] = currentStart.split(",").map(Number);
        loop.push({ x: sx, y: sy });
        visited.add(`${currentStart}->${currentNext}`);
        const candidates = edges.get(currentNext) ?? [];
        if (candidates.length === 0) break;
        const candidate = candidates.find((c) => !visited.has(`${currentNext}->${c}`)) ?? candidates[0];
        currentStart = currentNext;
        currentNext = candidate;
        if (currentStart === start && currentNext === next) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }

  if (loops.length === 0) return [];
  loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  return loops[0];
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function simplifyClosedPolyline(points: Point[], epsilon: number): Point[] {
  if (points.length < 8) return points;
  const closed = [...points, points[0]];
  const simplified = simplifyRdp(closed, epsilon);
  if (simplified.length <= 3) return points;
  simplified.pop();
  return simplified;
}

function chaikinSmoothClosedPolyline(points: Point[], iterations: number): Point[] {
  if (points.length < 4 || iterations <= 0) return points;
  let current = points.slice();
  for (let k = 0; k < iterations; k += 1) {
    const next: Point[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push({
        x: 0.75 * a.x + 0.25 * b.x,
        y: 0.75 * a.y + 0.25 * b.y,
      });
      next.push({
        x: 0.25 * a.x + 0.75 * b.x,
        y: 0.25 * a.y + 0.75 * b.y,
      });
    }
    current = next;
  }
  return current;
}

function downsampleClosedPolyline(points: Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints || maxPoints < 8) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  return out.length >= 3 ? out : points;
}

function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();
  let maxDist = -1;
  let index = -1;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = pointSegmentDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist <= epsilon || index < 0) return [first, last];
  const left = simplifyRdp(points.slice(0, index + 1), epsilon);
  const right = simplifyRdp(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function toExecutionCsv(spec: ExecutionSpec): string {
  const rows: string[] = [];
  rows.push(`${esc("specVersion")},${esc(spec.specVersion)}`);
  rows.push(`${esc("timestamp")},${esc(spec.timestamp)}`);
  rows.push(`${esc("folderPath")},${esc(spec.folderPath)}`);
  rows.push(`${esc("dpi")},${esc(spec.dpi)}`);
  rows.push(`${esc("sheet.wCm")},${esc(spec.sheet.wCm)}`);
  rows.push(`${esc("sheet.hCm")},${esc(spec.sheet.hCm)}`);
  rows.push(`${esc("gapMm")},${esc(spec.sheet.gapMm)}`);
  rows.push(`${esc("marginMm")},${esc(spec.sheet.marginMm)}`);
  rows.push(`${esc("algoVersion")},${esc(spec.algoVersion)}`);
  rows.push(`${esc("stickerSizing.mode")},${esc(spec.stickerSizing.mode)}`);
  if (spec.stickerSizing.mode === "physical") {
    rows.push(`${esc("stickerSizing.wCm")},${esc(spec.stickerSizing.wCm)}`);
    rows.push(`${esc("stickerSizing.hCm")},${esc(spec.stickerSizing.hCm)}`);
  }
  rows.push("");

  const includeSizing = spec.stickerSizing.mode === "perAsset";
  rows.push(includeSizing ? `${esc("assetId")},${esc("qty")},${esc("sizeAxis")},${esc("sizeCm")}` : `${esc("assetId")},${esc("qty")}`);

  for (const it of spec.quantities) {
    if (!includeSizing) {
      rows.push(`${esc(it.assetId)},${esc(it.qty)}`);
      continue;
    }
    if (it.sizing?.mode === "physical") {
      rows.push(`${esc(it.assetId)},${esc(it.qty)},${esc(it.sizing.axis)},${esc(it.sizing.sizeCm)}`);
      continue;
    }
    if (it.sizing?.mode === "fromImageDpi") {
      rows.push(`${esc(it.assetId)},${esc(it.qty)},${esc("dpi")},${esc("")}`);
      continue;
    }
    rows.push(`${esc(it.assetId)},${esc(it.qty)},${esc("")},${esc("")}`);
  }

  return rows.join("\n");
}

function esc(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadPdf(): void {
  if (!state.generated) return;
  const stableBytes = new Uint8Array(state.generated.pdfBytes);
  downloadBlob(new Blob([stableBytes], { type: "application/pdf" }), "imposition.pdf");
}

function downloadCsv(): void {
  if (!state.generated) return;
  downloadBlob(new Blob([state.generated.csvText], { type: "text/csv;charset=utf-8" }), "execution.csv");
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function renderDownloadActions(): void {
  downloadActions.classList.toggle("hidden", !state.generated);
}

function setSummary(): void {
  if (!state.generated) {
    summary.textContent = "Genera un trabajo para ver el armado.";
    return;
  }
  summary.textContent = `Motor: ${state.generated.spec.algoVersion} | Paginas: ${state.generated.totalPages} | Stickers: ${state.generated.totalPlaced} | Ocupacion prom: ${state.generated.occupancyAvgPct.toFixed(1)}%`;
}

function movePage(delta: number): void {
  if (!state.generated) return;
  const maxPage = Math.max(0, state.generated.totalPages - 1);
  state.previewPage = Math.min(maxPage, Math.max(0, state.previewPage + delta));
  drawPreview();
}

function drawPreview(): void {
  const generated = state.generated;
  const ctx = previewCanvas.getContext("2d");
  if (!ctx) return;

  const containerW = Math.max(320, previewCanvas.clientWidth || 320);
  const containerH = Math.max(380, previewCanvas.clientHeight || 380);
  const dpr = window.devicePixelRatio || 1;
  previewCanvas.width = Math.floor(containerW * dpr);
  previewCanvas.height = Math.floor(containerH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#f7f4ef";
  ctx.fillRect(0, 0, containerW, containerH);

  if (!generated) {
    ctx.fillStyle = "#625f5a";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("Sin preview todavia", 24, 40);
    pageLabel.textContent = "Pagina -/-";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const maxPage = Math.max(0, generated.totalPages - 1);
  state.previewPage = Math.min(state.previewPage, maxPage);
  const pageIndex = state.previewPage;

  const placements = generated.job.placements.filter((p) => p.pageIndex === pageIndex);
  const sheetW = generated.job.sheet.sheetWmm;
  const sheetH = generated.job.sheet.sheetHmm;
  const padding = 24;
  const scale = Math.min((containerW - padding * 2) / sheetW, (containerH - padding * 2) / sheetH);
  const renderW = sheetW * scale;
  const renderH = sheetH * scale;
  const originX = (containerW - renderW) / 2;
  const originY = (containerH - renderH) / 2;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#202020";
  ctx.lineWidth = 1;
  ctx.fillRect(originX, originY, renderW, renderH);
  ctx.strokeRect(originX, originY, renderW, renderH);

  for (const p of placements) {
    const x = originX + p.xMm * scale;
    const y = originY + renderH - (p.yMm + p.hMm) * scale;
    const w = p.wMm * scale;
    const h = p.hMm * scale;

    const image = state.imageById.get(p.assetId);
    if (image && image.complete && image.naturalWidth > 0) {
      if (p.rotate90) {
        ctx.save();
        ctx.translate(x, y + h);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(image, 0, 0, h, w);
        ctx.restore();
      } else {
        ctx.drawImage(image, x, y, w, h);
      }
    } else {
      ctx.fillStyle = "#d6d2cc";
      ctx.fillRect(x, y, w, h);
    }

    const wm = state.watermarkImage;
    if (wm && wm.complete && wm.naturalWidth > 0) {
      const cut = buildCutOptions();
      const bestCorner = pickPreviewBestCorner(image, !!p.rotate90);
      drawPreviewWatermark(ctx, wm, p.xMm, p.yMm, p.wMm, p.hMm, cut, bestCorner, scale, originX, originY, renderH);
    }

    ctx.strokeStyle = "#2b2b2b";
    ctx.strokeRect(x, y, w, h);
  }

  const pageOccupancy = generated.occupancyByPagePct[pageIndex] ?? 0;
  pageLabel.textContent = `Pagina ${pageIndex + 1}/${Math.max(1, generated.totalPages)} | Ocup: ${pageOccupancy.toFixed(1)}%`;
  prevPageBtn.disabled = pageIndex <= 0;
  nextPageBtn.disabled = pageIndex >= maxPage;
}

function setStatus(message: string): void {
  statusLine.textContent = message;
}

function drawPreviewWatermark(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  cut: CutOptions,
  bestCorner: Corner,
  scale: number,
  originX: number,
  originY: number,
  renderH: number
): void {
  void cut;
  const targetMm = clamp(Math.min(wMm, hMm) * 0.1, 2.2, 5.2);
  const insetMm = clamp(targetMm * 0.28, 0.8, 1.6);
  const ratio = image.naturalWidth / image.naturalHeight;
  const wmWmm = ratio >= 1 ? targetMm : targetMm * ratio;
  const wmHmm = ratio >= 1 ? targetMm / ratio : targetMm;

  const boxX = bestCorner === "tr" || bestCorner === "br" ? xMm + wMm - targetMm - insetMm : xMm + insetMm;
  const boxY = bestCorner === "tl" || bestCorner === "tr" ? yMm + hMm - targetMm - insetMm : yMm + insetMm;
  const wmXmm = boxX + (targetMm - wmWmm) / 2;
  const wmYmm = boxY + (targetMm - wmHmm) / 2;

  const x = originX + wmXmm * scale;
  const y = originY + renderH - (wmYmm + wmHmm) * scale;
  const w = wmWmm * scale;
  const h = wmHmm * scale;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();
}

function pickPreviewBestCorner(image: HTMLImageElement | undefined, rotate90: boolean): Corner {
  if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return "tr";
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "tr";
  ctx.clearRect(0, 0, size, size);
  if (rotate90) {
    ctx.save();
    ctx.translate(0, size);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, 0, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(image, 0, 0, size, size);
  }
  const data = ctx.getImageData(0, 0, size, size).data;
  const q = Math.floor(size * 0.2);
  const scores: Record<Corner, number> = {
    tl: avgAlpha(data, size, 0, 0, q, q),
    tr: avgAlpha(data, size, size - q, 0, q, q),
    bl: avgAlpha(data, size, 0, size - q, q, q),
    br: avgAlpha(data, size, size - q, size - q, q, q),
  };
  return pickBestCorner(scores);
}

function computeOccupancy(job: ImpositionJob, totalPages: number): { averagePct: number; byPagePct: number[] } {
  const pageCount = Math.max(1, totalPages);
  const byPageArea = new Array<number>(pageCount).fill(0);
  const sheetArea = job.sheet.sheetWmm * job.sheet.sheetHmm;
  if (sheetArea <= 0) return { averagePct: 0, byPagePct: byPageArea };

  for (const p of job.placements) {
    if (p.pageIndex < 0 || p.pageIndex >= byPageArea.length) continue;
    byPageArea[p.pageIndex] += p.wMm * p.hMm;
  }

  const byPagePct = byPageArea.map((area) => (area / sheetArea) * 100);
  const avgArea = byPageArea.reduce((acc, v) => acc + v, 0) / pageCount;
  const averagePct = (avgArea / sheetArea) * 100;
  return { averagePct, byPagePct };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
