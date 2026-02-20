import { writeFile } from "node:fs/promises";
import type { ExecutionSummary, OrderWriterPort } from "../../application/ports";

function esc(v: unknown) {
  const s = String(v ?? "");
  return `"${s.replace('"', '""')}"`;
}

export class CsvOrderWriter implements OrderWriterPort {
  async writeExecutionCsv(params: { csvPath: string; summary: ExecutionSummary }): Promise<void> {
    const { csvPath, summary } = params;

    const lines: string[] = [];
    lines.push(`${esc("timestamp")},${esc(summary.timestamp)}`);
    lines.push(`${esc("folderPath")},${esc(summary.folderPath)}`);
    lines.push(`${esc("outputPdfPath")},${esc(summary.outputPdfPath)}`);
    lines.push(`${esc("sheetWcm")},${esc(summary.sheetWcm)}`);
    lines.push(`${esc("sheetHcm")},${esc(summary.sheetHcm)}`);
    lines.push(`${esc("gapMm")},${esc(summary.gapMm)}`);
    lines.push(`${esc("marginMm")},${esc(summary.marginMm)}`);
    lines.push(`${esc("dpi")},${esc(summary.dpi)}`);
    lines.push(`${esc("capacityPerPage")},${esc(summary.capacityPerPage)}`);
    lines.push(`${esc("totalPlaced")},${esc(summary.totalPlaced)}`);
    lines.push(`${esc("totalPages")},${esc(summary.totalPages)}`);
    lines.push("");
    lines.push(`${esc("assetId")},${esc("qty")}`);

    for (const it of summary.items) {
      lines.push(`${esc(it.assetId)},${esc(it.qty)}`);
    }

    await writeFile(csvPath, lines.join("\n"), "utf-8");
  }
}