import { writeFile } from "node:fs/promises";
import type { OrderWriterPort } from "../../application/ports";
import type { ExecutionSpec } from "../../domain/models";

function esc(v: unknown) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export class CsvOrderWriter implements OrderWriterPort {
  async writeExecutionCsv(params: { csvPath: string; spec: ExecutionSpec }): Promise<void> {
    const { csvPath, spec } = params;

    const lines: string[] = [];
    lines.push(`${esc("specVersion")},${esc(spec.specVersion)}`);
    lines.push(`${esc("timestamp")},${esc(spec.timestamp)}`);
    lines.push(`${esc("folderPath")},${esc(spec.folderPath)}`);
    lines.push(`${esc("dpi")},${esc(spec.dpi)}`);
    lines.push(`${esc("sheet.wCm")},${esc(spec.sheet.wCm)}`);
    lines.push(`${esc("sheet.hCm")},${esc(spec.sheet.hCm)}`);
    lines.push(`${esc("gapMm")},${esc(spec.sheet.gapMm)}`);
    lines.push(`${esc("marginMm")},${esc(spec.sheet.marginMm)}`);
    lines.push(`${esc("algoVersion")},${esc(spec.algoVersion)}`);
    lines.push(`${esc("stickerSizing.mode")},${esc(spec.stickerSizing.mode)}`);
    if (spec.stickerSizing.mode === "physical") {
      lines.push(`${esc("stickerSizing.wCm")},${esc(spec.stickerSizing.wCm)}`);
      lines.push(`${esc("stickerSizing.hCm")},${esc(spec.stickerSizing.hCm)}`);
    }
    lines.push("");
    const includeSizing = spec.stickerSizing.mode === "perAsset";
    if (includeSizing) {
      lines.push(`${esc("assetId")},${esc("qty")},${esc("sizeAxis")},${esc("sizeCm")}`);
    } else {
      lines.push(`${esc("assetId")},${esc("qty")}`);
    }

    for (const it of spec.quantities) {
      if (!includeSizing) {
        lines.push(`${esc(it.assetId)},${esc(it.qty)}`);
        continue;
      }

      let axis = "";
      let sizeCm = "";
      if (it.sizing?.mode === "physical") {
        axis = it.sizing.axis;
        sizeCm = String(it.sizing.sizeCm);
      } else if (it.sizing?.mode === "fromImageDpi") {
        axis = "dpi";
      }

      lines.push(`${esc(it.assetId)},${esc(it.qty)},${esc(axis)},${esc(sizeCm)}`);
    }

    await writeFile(csvPath, lines.join("\n"), "utf-8");
  }
}
