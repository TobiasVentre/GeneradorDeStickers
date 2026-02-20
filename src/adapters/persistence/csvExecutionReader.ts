import { readFile } from "node:fs/promises";

export interface ExecutionCsvData {
  timestamp: string;
  folderPath: string;
  sheetWcm: number;
  sheetHcm: number;
  gapMm: number;
  marginMm: number;
  dpi: number;
  marginMmMaybe?: number; // compat si falta
  items: Array<{ assetId: string; qty: number }>;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    // CSV: "" significa una comilla literal
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function parseKVLine(line: string): { k: string; v: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Esperamos: "key","value"
  const parts = trimmed.split(",");
  if (parts.length < 2) return null;

  const k = unquote(parts[0]);
  const v = unquote(parts.slice(1).join(",")); // por si el value contiene comas
  return { k, v };
}

export async function readExecutionCsv(csvPath: string): Promise<ExecutionCsvData> {
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
    const kv = parseKVLine(line);
    if (kv) meta[kv.k] = kv.v;
  }

  // 2) Buscar header assetId,qty
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const a = unquote(line.split(",")[0]).toLowerCase();
    if (a === "assetid") {
      i++; // pasar a datos
      break;
    }
  }

  // 3) Leer items
  const items: Array<{ assetId: string; qty: number }> = [];
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 2) continue;

    const assetId = unquote(parts[0]);
    const qtyStr = unquote(parts.slice(1).join(","));
    const qty = Math.max(0, Math.trunc(Number(qtyStr)));

    items.push({ assetId, qty });
  }

  const sheetWcm = Number(meta.sheetWcm ?? 100);
  const sheetHcm = Number(meta.sheetHcm ?? 50);
  const gapMm = Number(meta.gapMm ?? 3);
  const marginMm = Number(meta.marginMm ?? 0);
  const dpi = Number(meta.dpi ?? 300);

  return {
    timestamp: meta.timestamp ?? "",
    folderPath: meta.folderPath ?? "",
    sheetWcm,
    sheetHcm,
    gapMm,
    marginMm,
    dpi,
    items,
  };
}

/**
 * Wrapper OO para que el CLI pueda importar `CsvExecutionReader`.
 */
export class CsvExecutionReader {
  async read(csvPath: string): Promise<ExecutionCsvData> {
    return readExecutionCsv(csvPath);
  }
}