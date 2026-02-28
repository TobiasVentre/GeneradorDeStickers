import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CsvOrderWriter } from "../adapters/persistence/csvOrderWriter";
import { CsvExecutionReader } from "../adapters/persistence/csvExecutionReader";
import { imposeFromSpec } from "../application/usecases/imposeFolder";
import {
  ALGO_SHELF_MIXED_V1,
  DEFAULT_ALGO_VERSION,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  ExecutionSpec,
  defaultExecutionSheet,
  defaultStickerSizing,
} from "../domain/models";
import type { CatalogPort, PngAssetInfo } from "../application/ports";

const mockAssets: PngAssetInfo[] = [
  { assetId: "a.png", filePath: "C:\\tmp\\a.png", widthPx: 1000, heightPx: 500 },
  { assetId: "b.png", filePath: "C:\\tmp\\b.png", widthPx: 1000, heightPx: 500 },
];

const mockCatalog: CatalogPort = {
  async listPngAssets(_folderPath: string): Promise<PngAssetInfo[]> {
    return mockAssets;
  },
};

function buildSpec(overrides?: Partial<ExecutionSpec>): ExecutionSpec {
  const sheet = defaultExecutionSheet();
  const sizing = defaultStickerSizing();
  return {
    specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
    timestamp: "2026-02-20T10:00:00Z",
    folderPath: "C:\\stickers\\folder",
    dpi: DEFAULT_DPI,
    sheet: {
      wCm: sheet.wCm,
      hCm: sheet.hCm,
      gapMm: sheet.gapMm,
      marginMm: sheet.marginMm,
    },
    stickerSizing: sizing,
    quantities: [
      { assetId: "a.png", qty: 2 },
      { assetId: "b.png", qty: 3 },
    ],
    algoVersion: DEFAULT_ALGO_VERSION,
    ...overrides,
  };
}

test("CSV roundtrip (physical)", async () => {
  const spec = buildSpec({
    stickerSizing: { mode: "physical", wCm: 6, hCm: 6 },
  });
  const tmp = await mkdtemp(join(tmpdir(), "sticker-imposer-"));
  const csvPath = join(tmp, "spec.csv");

  const writer = new CsvOrderWriter();
  await writer.writeExecutionCsv({ csvPath, spec });

  const reader = new CsvExecutionReader();
  const parsed = await reader.read(csvPath);

  assert.deepEqual(parsed, spec);
});

test("CSV roundtrip (fromImageDpi)", async () => {
  const spec = buildSpec({
    stickerSizing: { mode: "fromImageDpi" },
  });
  const tmp = await mkdtemp(join(tmpdir(), "sticker-imposer-"));
  const csvPath = join(tmp, "spec.csv");

  const writer = new CsvOrderWriter();
  await writer.writeExecutionCsv({ csvPath, spec });

  const reader = new CsvExecutionReader();
  const parsed = await reader.read(csvPath);

  assert.deepEqual(parsed, spec);
});

test("Compat CSV viejo", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "sticker-imposer-"));
  const csvPath = join(tmp, "old.csv");

  const csv = [
    "\"timestamp\",\"2026-02-20T10:00:00Z\"",
    "\"folderPath\",\"C:\\\\stickers\\\\folder\"",
    "\"dpi\",\"300\"",
    "",
    "\"assetId\",\"qty\"",
    "\"a.png\",\"2\"",
  ].join("\n");

  await writeFile(csvPath, csv, "utf-8");

  const reader = new CsvExecutionReader();
  const spec = await reader.read(csvPath);
  const defaults = defaultExecutionSheet();
  const sizingDefaults = defaultStickerSizing();

  assert.equal(spec.specVersion, DEFAULT_EXECUTION_SPEC_VERSION);
  assert.equal(spec.algoVersion, DEFAULT_ALGO_VERSION);
  assert.equal(spec.dpi, 300);
  assert.equal(spec.sheet.wCm, defaults.wCm);
  assert.equal(spec.sheet.hCm, defaults.hCm);
  assert.equal(spec.sheet.gapMm, defaults.gapMm);
  assert.equal(spec.sheet.marginMm, defaults.marginMm);
  assert.deepEqual(spec.stickerSizing, sizingDefaults);
  assert.deepEqual(spec.quantities, [{ assetId: "a.png", qty: 2 }]);
});

test("Determinismo (physical)", async () => {
  const spec = buildSpec({
    stickerSizing: { mode: "physical", wCm: 6, hCm: 6 },
  });

  const r1 = await imposeFromSpec({ catalog: mockCatalog, spec });
  const r2 = await imposeFromSpec({ catalog: mockCatalog, spec });

  assert.equal(r1.job.layout?.capacityPerPage, r2.job.layout?.capacityPerPage);
  assert.equal(r1.totalPages, r2.totalPages);
});

test("DPI-based sizing produce tamaño correcto", async () => {
  const spec = buildSpec({
    dpi: 300,
    stickerSizing: { mode: "fromImageDpi" },
  });

  const r = await imposeFromSpec({ catalog: mockCatalog, spec });
  const expectedWmm = (mockAssets[0].widthPx / spec.dpi) * 25.4;
  const expectedHmm = (mockAssets[0].heightPx / spec.dpi) * 25.4;

  assert.ok(Math.abs((r.job.layout?.stickerWmm ?? 0) - expectedWmm) < 0.0001);
  assert.ok(Math.abs((r.job.layout?.stickerHmm ?? 0) - expectedHmm) < 0.0001);
});

test("CSV roundtrip (perAsset)", async () => {
  const spec = buildSpec({
    algoVersion: ALGO_SHELF_MIXED_V1,
    stickerSizing: { mode: "perAsset" },
    quantities: [
      { assetId: "a.png", qty: 2, sizing: { mode: "physical", axis: "w", sizeCm: 5 } },
      { assetId: "b.png", qty: 3, sizing: { mode: "physical", axis: "h", sizeCm: 4 } },
    ],
  });
  const tmp = await mkdtemp(join(tmpdir(), "sticker-imposer-"));
  const csvPath = join(tmp, "spec.csv");

  const writer = new CsvOrderWriter();
  await writer.writeExecutionCsv({ csvPath, spec });

  const reader = new CsvExecutionReader();
  const parsed = await reader.read(csvPath);

  assert.deepEqual(parsed, spec);
});
