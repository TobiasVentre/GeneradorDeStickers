import readline from "node:readline";
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

import { FsPngCatalog } from "../catalog/fsPngCatalog";
import { imposeFolder } from "../../application/usecases/imposeFolder";
import { PdfLibRenderer } from "../renderer/pdfLibRenderer";

import { CsvOrderWriter } from "../persistence/csvOrderWriter";
import { readExecutionCsv } from "../persistence/csvExecutionReader";

const BASE_FOLDER = "C:\\Users\\Usuario\\stickers"; // carpeta “raíz” donde tenés subcarpetas con PNGs
const OUTPUTS_DIR = "C:\\Users\\Usuario\\stickers\\outputs"; // outputs sueltos acá

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

function toIntOrZero(s: string): number {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function nowTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

async function ensureOutputsDir(): Promise<void> {
  await mkdir(OUTPUTS_DIR, { recursive: true });
}

async function chooseFolder(): Promise<string> {
  console.log(`\n📂 Buscando carpetas en: ${BASE_FOLDER}\n`);

  const entries = await readdir(BASE_FOLDER, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    throw new Error("No se encontraron subcarpetas dentro de la carpeta base.");
  }

  dirs.forEach((d, i) => console.log(`${i + 1}) ${d}`));

  const choice = Number(await ask("\nElegí una carpeta (número): "));

  if (!choice || choice < 1 || choice > dirs.length) {
    throw new Error("Selección inválida.");
  }

  return join(BASE_FOLDER, dirs[choice - 1]);
}

async function chooseCsvFromOutputsRoot(): Promise<string> {
  await ensureOutputsDir();

  const entries = await readdir(OUTPUTS_DIR, { withFileTypes: true });

  // CSVs en la raíz: pedido_*.csv
  const csvs = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .filter((name) => name.toLowerCase().startsWith("pedido_"))
    .sort()
    .reverse();

  if (csvs.length === 0) {
    throw new Error(`No hay CSVs en: ${OUTPUTS_DIR}`);
  }

  console.log(`\n🧾 CSVs disponibles en: ${OUTPUTS_DIR}\n`);
  csvs.forEach((f, i) => console.log(`${i + 1}) ${f}`));

  const choice = Number(await ask("\nElegí un CSV (número): "));

  if (!choice || choice < 1 || choice > csvs.length) {
    throw new Error("Selección inválida.");
  }

  return join(OUTPUTS_DIR, csvs[choice - 1]);
}

async function runNewExecution(): Promise<void> {
  await ensureOutputsDir();

  const folderPath = await chooseFolder();
  const folderName = basename(folderPath);

  console.log(`\n📁 Usando carpeta: ${folderPath}`);

  const catalog = new FsPngCatalog();
  const assets = await catalog.listPngAssets(folderPath);

  console.log(`\nEncontré ${assets.length} PNG(s):`);
  assets.forEach((a) => console.log(`- ${a.assetId} (${a.widthPx}x${a.heightPx}px)`));

  console.log("\nIngresá cantidades por archivo:");

  const items: Array<{ assetId: string; qty: number }> = [];
  for (const a of assets) {
    const qty = toIntOrZero(await ask(`${a.assetId} -> cantidad? `));
    items.push({ assetId: a.assetId, qty });
  }

  const dpi = 300;

  const result = await imposeFolder({
    folderPath,
    catalog,
    quantities: items,
    dpi,
  });

  const { job, totalPlaced, totalPages } = result;

  console.log("\n=== RESUMEN ===");
  console.log(`Sticker: ${(job.layout.stickerWmm / 10).toFixed(2)} cm`);
  console.log(`Entran por pliego: ${job.layout.capacityPerPage}`);
  console.log(`Total pedidos: ${totalPlaced}`);
  console.log(`Páginas necesarias: ${totalPages}`);

  const ts = nowTimestamp();

  const outputPdfPath = join(OUTPUTS_DIR, `pliego_${folderName}_${ts}.pdf`);
  const outputCsvPath = join(OUTPUTS_DIR, `pedido_${folderName}_${ts}.csv`);

  // =========================
  // PDF
  // =========================
  const renderer = new PdfLibRenderer();

  const assetPathById: Record<string, string> = {};
  result.assets.forEach((a) => {
    assetPathById[a.assetId] = a.filePath;
  });

  await renderer.renderPdf({
    job,
    assetPathById,
    outputPath: outputPdfPath,
    options: {
      drawBoxes: true,
      crosshair: true,
    },
  });

  console.log(`\n✅ PDF generado correctamente:\n${outputPdfPath}`);

  // =========================
  // CSV (metadata + items)
  // =========================
  const csvWriter = new CsvOrderWriter();

  await csvWriter.writeExecutionCsv({
    // ✅ clave correcta según tu tipo: csvPath
    csvPath: outputCsvPath,
    // ✅ clave correcta según tu tipo: summary
    summary: {
      timestamp: ts,
      folderPath,
      outputPdfPath,
      sheetWcm: job.sheet.sheetWmm / 10,
      sheetHcm: job.sheet.sheetHmm / 10,
      gapMm: job.sheet.gapMm,
      marginMm: job.sheet.marginMm,
      dpi,
      capacityPerPage: job.layout.capacityPerPage,
      totalPlaced,
      totalPages,
      // ✅ usar "items" (coincide con tu reader)
      items,
    },
  });

  console.log(`✅ CSV generado:\n${outputCsvPath}`);
  console.log(`\n📦 Output guardado en:\n${OUTPUTS_DIR}`);
}

async function runFromExistingCsv(): Promise<void> {
  await ensureOutputsDir();

  const csvPath = await chooseCsvFromOutputsRoot();
  console.log(`\n📄 Usando CSV:\n${csvPath}`);

  // ✅ tu reader real es una FUNCIÓN
  const exec = await readExecutionCsv(csvPath);

  const folderPath = exec.folderPath;
  const folderName = basename(folderPath);

  const catalog = new FsPngCatalog();
  const assets = await catalog.listPngAssets(folderPath);

  const assetPathById: Record<string, string> = {};
  assets.forEach((a) => (assetPathById[a.assetId] = a.filePath));

  const result = await imposeFolder({
    folderPath,
    catalog,
    // ✅ tu reader devuelve exec.items
    quantities: exec.items,
    dpi: exec.dpi,
    // Si tu usecase acepta sheet/gap/margin, pasalos acá:
    // sheetWcm: exec.sheetWcm,
    // sheetHcm: exec.sheetHcm,
    // gapMm: exec.gapMm,
    // marginMm: exec.marginMm,
  });

  const { job, totalPlaced, totalPages } = result;

  console.log("\n=== RESUMEN (RE-EJECUCIÓN) ===");
  console.log(`Sticker: ${(job.layout.stickerWmm / 10).toFixed(2)} cm`);
  console.log(`Entran por pliego: ${job.layout.capacityPerPage}`);
  console.log(`Total pedidos: ${totalPlaced}`);
  console.log(`Páginas necesarias: ${totalPages}`);

  const renderer = new PdfLibRenderer();

  const ts = nowTimestamp();
  const outputPdfPath = join(OUTPUTS_DIR, `pliego_${folderName}_reprint_${ts}.pdf`);

  await renderer.renderPdf({
    job,
    assetPathById,
    outputPath: outputPdfPath,
    options: {
      drawBoxes: true,
      crosshair: true,
    },
  });

  console.log(`\n✅ PDF generado correctamente (sin CSV):\n${outputPdfPath}`);
  console.log(`\n📦 Output guardado en:\n${OUTPUTS_DIR}`);
}

export async function runCli(): Promise<void> {
  console.log("\n🚀 Sticker Imposer iniciado\n");

  console.log("¿Qué querés hacer?");
  console.log("1) Nueva ejecución (wizard + genera PDF y CSV)");
  console.log("2) Re-ejecutar desde un CSV existente (genera SOLO PDF)\n");

  const choice = Number(await ask("Elegí (1/2): "));

  if (choice === 1) {
    await runNewExecution();
    return;
  }

  if (choice === 2) {
    await runFromExistingCsv();
    return;
  }

  throw new Error("Opción inválida.");
}