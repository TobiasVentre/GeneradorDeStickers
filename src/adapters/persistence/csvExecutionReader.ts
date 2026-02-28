import { readFile } from "node:fs/promises";
import {
  DEFAULT_ALGO_VERSION,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  ExecutionSpecItem,
  ExecutionSpec,
  ExecutionSpecVersion,
  StickerSizing,
  defaultExecutionSheet,
  defaultStickerSizing,
} from "../../domain/models";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      fields.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  fields.push(cur);
  return fields;
}

function cleanKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim();
}

function toNumber(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSpec(meta: Record<string, string>, quantities: ExecutionSpecItem[]): ExecutionSpec {
  const sheetDefaults = defaultExecutionSheet();
  const sizingDefaults = defaultStickerSizing();
  const defaultSizingWcm = sizingDefaults.mode === "physical" ? sizingDefaults.wCm : 6;
  const defaultSizingHcm = sizingDefaults.mode === "physical" ? sizingDefaults.hCm : 6;

  const wCm = toNumber(meta["sheet.wCm"] ?? meta.sheetWcm, sheetDefaults.wCm);
  const hCm = toNumber(meta["sheet.hCm"] ?? meta.sheetHcm, sheetDefaults.hCm);
  const gapMm = toNumber(meta.gapMm, sheetDefaults.gapMm);
  const marginMm = toNumber(meta.marginMm, sheetDefaults.marginMm);

  const specVersion = toNumber(meta.specVersion, DEFAULT_EXECUTION_SPEC_VERSION) as ExecutionSpecVersion;
  const sizingMode = (meta["stickerSizing.mode"] ?? "").trim();
  let stickerSizing: StickerSizing;
  if (sizingMode === "fromImageDpi") {
    stickerSizing = { mode: "fromImageDpi" };
  } else if (sizingMode === "physical") {
    stickerSizing = {
      mode: "physical",
      wCm: toNumber(meta["stickerSizing.wCm"], defaultSizingWcm),
      hCm: toNumber(meta["stickerSizing.hCm"], defaultSizingHcm),
    };
  } else if (sizingMode === "perAsset") {
    stickerSizing = { mode: "perAsset" };
  } else {
    stickerSizing = sizingDefaults;
  }

  return {
    specVersion,
    timestamp: meta.timestamp ?? "",
    folderPath: meta.folderPath ?? "",
    dpi: toNumber(meta.dpi, DEFAULT_DPI),
    sheet: { wCm, hCm, gapMm, marginMm },
    stickerSizing,
    quantities,
    algoVersion: meta.algoVersion ?? DEFAULT_ALGO_VERSION,
  };
}

export async function readExecutionCsv(csvPath: string): Promise<ExecutionSpec> {
  const raw = await readFile(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/);

  const meta: Record<string, string> = {};
  let i = 0;

  // 1) Leer metadata key,value hasta línea vacía
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++; // saltar línea vacía
      break;
    }

    const parts = parseCsvLine(line);
    if (parts.length < 2) continue;

    const key = cleanKey(parts[0]);
    const value = parts.slice(1).join(",").trim();
    if (key) meta[key] = value;
  }

  // 2) Buscar header assetId,qty
  let header: string[] | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCsvLine(line);
    const a = cleanKey(parts[0] ?? "").toLowerCase();
    if (a === "assetid") {
      header = parts.map((p) => cleanKey(p));
      i++; // pasar a datos
      break;
    }
  }

  // 3) Leer items
  const items: ExecutionSpecItem[] = [];
  const headerLower = (header ?? []).map((h) => h.toLowerCase());
  const idxAsset = headerLower.indexOf("assetid");
  const idxQty = headerLower.indexOf("qty");
  const idxSizeAxis = headerLower.indexOf("sizeaxis");
  const idxSizeCm = headerLower.indexOf("sizecm");

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCsvLine(line);
    if (parts.length < 2) continue;

    const assetId = (parts[idxAsset >= 0 ? idxAsset : 0] ?? "").trim();
    const qtyStr = (parts[idxQty >= 0 ? idxQty : 1] ?? "").trim();
    const qty = Math.max(0, Math.trunc(Number(qtyStr)));

    let sizing: ExecutionSpecItem["sizing"] | undefined;
    const axisRaw = (idxSizeAxis >= 0 ? parts[idxSizeAxis] : "").trim().toLowerCase();
    const sizeCmRaw = (idxSizeCm >= 0 ? parts[idxSizeCm] : "").trim();
    const sizeCm = Number(sizeCmRaw);

    if (axisRaw === "w" || axisRaw === "h") {
      if (Number.isFinite(sizeCm) && sizeCm > 0) {
        sizing = { mode: "physical", axis: axisRaw, sizeCm };
      }
    } else if (axisRaw === "dpi") {
      sizing = { mode: "fromImageDpi" };
    }

    if (assetId) {
      const item: ExecutionSpecItem = { assetId, qty };
      if (sizing) item.sizing = sizing;
      items.push(item);
    }
  }

  const spec = normalizeSpec(meta, items);

  if (!spec.folderPath) {
    throw new Error("CSV inválido: falta folderPath en metadata.");
  }

  return spec;
}

/**
 * Wrapper OO para que el CLI pueda importar `CsvExecutionReader`.
 */
export class CsvExecutionReader {
  async read(csvPath: string): Promise<ExecutionSpec> {
    return readExecutionCsv(csvPath);
  }
}
