import "./styles.css";
import { PDFDocument } from "pdf-lib";
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
  pdfBytes: Uint8Array;
  csvText: string;
};

class BrowserCatalog implements CatalogPort {
  constructor(private readonly assets: PngAssetInfo[]) {}

  async listPngAssets(_folderPath: string): Promise<PngAssetInfo[]> {
    return this.assets;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontro #app");

const sheetDefaults = defaultExecutionSheet();

const state: {
  assets: LoadedAsset[];
  qtyById: Map<string, number>;
  generated: GeneratedArtifacts | null;
  previewPage: number;
  imageById: Map<string, HTMLImageElement>;
} = {
  assets: [],
  qtyById: new Map<string, number>(),
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
          DPI
          <input id="dpiInput" type="number" min="1" value="${DEFAULT_DPI}" />
        </label>
      </div>

      <div class="grid two">
        <label class="block">Ancho pliego (cm)<input id="sheetWInput" type="number" min="1" value="${sheetDefaults.wCm}" /></label>
        <label class="block">Alto pliego (cm)<input id="sheetHInput" type="number" min="1" value="${sheetDefaults.hCm}" /></label>
        <label class="block">Gap (mm)<input id="gapInput" type="number" min="0" value="${sheetDefaults.gapMm}" /></label>
        <label class="block">Margen (mm)<input id="marginInput" type="number" min="0" value="${sheetDefaults.marginMm}" /></label>
      </div>

      <h2>Assets y cantidades</h2>
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
const dpiInput = mustElement<HTMLInputElement>("dpiInput");
const sheetWInput = mustElement<HTMLInputElement>("sheetWInput");
const sheetHInput = mustElement<HTMLInputElement>("sheetHInput");
const gapInput = mustElement<HTMLInputElement>("gapInput");
const marginInput = mustElement<HTMLInputElement>("marginInput");
const assetsWrap = mustElement<HTMLDivElement>("assetsWrap");
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

  assetsWrap.innerHTML = `
    <table class="assets-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Px</th>
          <th>Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${state.assets
          .map((asset) => {
            const value = state.qtyById.get(asset.assetId) ?? 0;
            return `
            <tr>
              <td title="${asset.assetId}">${escapeHtml(asset.assetId)}</td>
              <td>${asset.widthPx}x${asset.heightPx}</td>
              <td><input data-asset-id="${escapeHtml(asset.assetId)}" class="qty-input" type="number" min="0" value="${value}" /></td>
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
    const catalog = new BrowserCatalog(state.assets);
    const result = await imposeFromSpec({ catalog, spec });
    const pdfBytes = await renderPdfInBrowser(result.job, state.assets);
    const csvText = toExecutionCsv(spec);

    state.generated = {
      spec,
      job: result.job,
      totalPages: result.totalPages,
      totalPlaced: result.totalPlaced,
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
  const dpi = toPositiveNumber(dpiInput.value, DEFAULT_DPI);
  const algoVersion = engineSelect.value;

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
      quantities: quantities.map((q) => ({ ...q, sizing: { mode: "fromImageDpi" } })),
      algoVersion,
    };
  }

  return {
    specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
    timestamp: nowIsoNoMs(),
    folderPath: "browser://selected-files",
    dpi,
    sheet: { wCm: sheetWcm, hCm: sheetHcm, gapMm, marginMm },
    stickerSizing: { mode: "fromImageDpi" },
    quantities,
    algoVersion,
  };
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

const mmToPt = (mm: number): number => (mm * 72) / 25.4;

async function renderPdfInBrowser(job: ImpositionJob, assets: LoadedAsset[]): Promise<Uint8Array> {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const doc = await PDFDocument.create();
  const pageW = mmToPt(job.sheet.sheetWmm);
  const pageH = mmToPt(job.sheet.sheetHmm);
  const maxPageIndex = job.placements.reduce((m, p) => Math.max(m, p.pageIndex), -1);
  const pageCount = Math.max(maxPageIndex + 1, 1);
  const pages = Array.from({ length: pageCount }, () => doc.addPage([pageW, pageH]));
  const cache = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

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
    page.drawImage(png, {
      x: mmToPt(p.xMm),
      y: mmToPt(p.yMm),
      width: mmToPt(p.wMm),
      height: mmToPt(p.hMm),
    });
  }

  return await doc.save();
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
  summary.textContent = `Motor: ${state.generated.spec.algoVersion} | Paginas: ${state.generated.totalPages} | Stickers: ${state.generated.totalPlaced}`;
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
      ctx.drawImage(image, x, y, w, h);
    } else {
      ctx.fillStyle = "#d6d2cc";
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = "#2b2b2b";
    ctx.strokeRect(x, y, w, h);
  }

  pageLabel.textContent = `Pagina ${pageIndex + 1}/${Math.max(1, generated.totalPages)}`;
  prevPageBtn.disabled = pageIndex <= 0;
  nextPageBtn.disabled = pageIndex >= maxPage;
}

function setStatus(message: string): void {
  statusLine.textContent = message;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
