import readline from "node:readline";
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

import { FsPngCatalog } from "../catalog/fsPngCatalog";
import { imposeFromSpec } from "../../application/usecases/imposeFolder";
import { PdfLibRenderer } from "../renderer/pdfLibRenderer";

import { CsvOrderWriter } from "../persistence/csvOrderWriter";
import { CsvExecutionReader } from "../persistence/csvExecutionReader";
import {
  ALGO_GRID_V1,
  ALGO_SHELF_MIXED_V1,
  DEFAULT_ALGO_VERSION,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  ExecutionSpec,
  defaultExecutionSheet,
} from "../../domain/models";

const BASE_FOLDER = "C:\\Users\\Usuario\\stickers"; // carpeta raiz donde tenes subcarpetas con PNGs
const OUTPUTS_DIR = "C:\\Users\\Usuario\\stickers\\outputs"; // outputs sueltos aca

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

function nowIsoNoMs(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toPositiveNumberOrThrow(value: string, label: string): number {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} invalido. Debe ser un numero > 0.`);
  }
  return n;
}

async function ensureOutputsDir(): Promise<void> {
  await mkdir(OUTPUTS_DIR, { recursive: true });
}

async function chooseFolder(): Promise<string> {
  console.log(`\nBuscando carpetas en: ${BASE_FOLDER}\n`);

  const entries = await readdir(BASE_FOLDER, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (dirs.length === 0) {
    throw new Error("No se encontraron subcarpetas dentro de la carpeta base.");
  }

  dirs.forEach((d, i) => console.log(`${i + 1}) ${d}`));

  const choice = Number(await ask("\nElegi una carpeta (numero): "));

  if (!choice || choice < 1 || choice > dirs.length) {
    throw new Error("Seleccion invalida.");
  }

  return join(BASE_FOLDER, dirs[choice - 1]);
}

async function chooseCsvFromOutputsRoot(): Promise<string> {
  await ensureOutputsDir();

  const entries = await readdir(OUTPUTS_DIR, { withFileTypes: true });

  // CSVs en la raiz: pedido_*.csv
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

  console.log(`\nCSVs disponibles en: ${OUTPUTS_DIR}\n`);
  csvs.forEach((f, i) => console.log(`${i + 1}) ${f}`));

  const choice = Number(await ask("\nElegi un CSV (numero): "));

  if (!choice || choice < 1 || choice > csvs.length) {
    throw new Error("Seleccion invalida.");
  }

  return join(OUTPUTS_DIR, csvs[choice - 1]);
}

async function runNewExecution(): Promise<void> {
  await ensureOutputsDir();

  const folderPath = await chooseFolder();
  const folderName = basename(folderPath);

  console.log(`\nUsando carpeta: ${folderPath}`);

  const catalog = new FsPngCatalog();
  const assets = (await catalog.listPngAssets(folderPath)).slice().sort((a, b) => {
    return a.assetId.localeCompare(b.assetId);
  });

  console.log(`\nEncontre ${assets.length} PNG(s):`);
  assets.forEach((a) => console.log(`- ${a.assetId} (${a.widthPx}x${a.heightPx}px)`));

  console.log("\nMotor de imposicion:");
  console.log("1) Grilla uniforme (mismo tamano para todos)");
  console.log("2) Mixed simple (tamanos por PNG, sin optimizacion)\n");

  const engineChoice = Number(await ask("Elegi (1/2): "));
  const algoVersion = engineChoice === 2 ? ALGO_SHELF_MIXED_V1 : ALGO_GRID_V1;

  const items: ExecutionSpec["quantities"] = [];

  if (algoVersion === ALGO_SHELF_MIXED_V1) {
    console.log("\nIngresa tamano (cm) y cantidad por archivo:");
    for (const a of assets) {
      const axisRaw = (await ask(`${a.assetId} -> usar ancho o alto? (w/h): `)).trim().toLowerCase();
      if (axisRaw !== "w" && axisRaw !== "h") {
        throw new Error("Opcion invalida. Usa 'w' o 'h'.");
      }
      const sizeCm = toPositiveNumberOrThrow(await ask(`  ${axisRaw === "w" ? "Ancho" : "Alto"} (cm): `), "Tamano");
      const qty = toIntOrZero(await ask(`  ${a.assetId} -> cantidad? `));
      items.push({
        assetId: a.assetId,
        qty,
        sizing: { mode: "physical", axis: axisRaw, sizeCm },
      });
    }
  } else {
    console.log("\nIngresa cantidades por archivo:");
    for (const a of assets) {
      const qty = toIntOrZero(await ask(`${a.assetId} -> cantidad? `));
      items.push({ assetId: a.assetId, qty });
    }
  }

  let stickerSizing: ExecutionSpec["stickerSizing"];
  if (algoVersion === ALGO_SHELF_MIXED_V1) {
    stickerSizing = { mode: "perAsset" };
  } else {
    console.log("\nEstrategia de tamano de sticker:");
    console.log("1) Tamano manual (cm)");
    console.log("2) Respetar DPI de imagen\n");

    const sizingChoice = Number(await ask("Elegi (1/2): "));
    if (sizingChoice === 1) {
      const wCm = toPositiveNumberOrThrow(await ask("Ancho (cm): "), "Ancho");
      const hCm = toPositiveNumberOrThrow(await ask("Alto (cm): "), "Alto");
      stickerSizing = { mode: "physical", wCm, hCm };
    } else if (sizingChoice === 2) {
      stickerSizing = { mode: "fromImageDpi" };
    } else {
      throw new Error("Opcion invalida.");
    }
  }

  const sheetDefaults = defaultExecutionSheet();
  const spec: ExecutionSpec = {
    specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
    timestamp: nowIsoNoMs(),
    folderPath,
    dpi: DEFAULT_DPI,
    sheet: {
      wCm: sheetDefaults.wCm,
      hCm: sheetDefaults.hCm,
      gapMm: sheetDefaults.gapMm,
      marginMm: sheetDefaults.marginMm,
    },
    stickerSizing,
    quantities: items,
    algoVersion,
  };

  const result = await imposeFromSpec({
    catalog,
    spec,
  });

  const { job, totalPlaced, totalPages } = result;

  console.log("\n=== RESUMEN ===");
  console.log(`Motor: ${job.engineId}`);
  if (job.layout) {
    console.log(`Sticker: ${(job.layout.stickerWmm / 10).toFixed(2)} cm`);
    console.log(`Entran por pliego: ${job.layout.capacityPerPage}`);
  }
  console.log(`Total pedidos: ${totalPlaced}`);
  console.log(`Paginas necesarias: ${totalPages}`);

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

  console.log(`\nPDF generado correctamente:\n${outputPdfPath}`);

  // =========================
  // CSV (metadata + items)
  // =========================
  const csvWriter = new CsvOrderWriter();

  await csvWriter.writeExecutionCsv({
    csvPath: outputCsvPath,
    spec,
  });

  console.log(`CSV generado:\n${outputCsvPath}`);
  console.log(`\nOutput guardado en:\n${OUTPUTS_DIR}`);
}

async function runFromExistingCsv(): Promise<void> {
  await ensureOutputsDir();

  const csvPath = await chooseCsvFromOutputsRoot();
  console.log(`\nUsando CSV:\n${csvPath}`);

  const reader = new CsvExecutionReader();
  const spec = await reader.read(csvPath);

  const folderPath = spec.folderPath;
  const folderName = basename(folderPath);

  const catalog = new FsPngCatalog();
  const result = await imposeFromSpec({
    catalog,
    spec,
  });

  const { job, totalPlaced, totalPages } = result;

  console.log("\n=== RESUMEN (RE-EJECUCION) ===");
  console.log(`Motor: ${job.engineId}`);
  if (job.layout) {
    console.log(`Sticker: ${(job.layout.stickerWmm / 10).toFixed(2)} cm`);
    console.log(`Entran por pliego: ${job.layout.capacityPerPage}`);
  }
  console.log(`Total pedidos: ${totalPlaced}`);
  console.log(`Paginas necesarias: ${totalPages}`);

  const renderer = new PdfLibRenderer();

  const ts = nowTimestamp();
  const outputPdfPath = join(OUTPUTS_DIR, `pliego_${folderName}_reprint_${ts}.pdf`);

  const assetPathById: Record<string, string> = {};
  result.assets.forEach((a) => (assetPathById[a.assetId] = a.filePath));

  await renderer.renderPdf({
    job,
    assetPathById,
    outputPath: outputPdfPath,
    options: {
      drawBoxes: true,
      crosshair: true,
    },
  });

  console.log(`\nPDF generado correctamente (sin CSV):\n${outputPdfPath}`);
  console.log(`\nOutput guardado en:\n${OUTPUTS_DIR}`);
}

export async function runCli(): Promise<void> {
  console.log("\nSticker Imposer iniciado\n");

  console.log("Que queres hacer?");
  console.log("1) Nueva ejecucion (wizard + genera PDF y CSV)");
  console.log("2) Re-ejecutar desde un CSV existente (genera SOLO PDF)\n");

  const choice = Number(await ask("Elegi (1/2): "));

  if (choice === 1) {
    await runNewExecution();
    return;
  }

  if (choice === 2) {
    await runFromExistingCsv();
    return;
  }

  throw new Error("Opcion invalida.");
}
