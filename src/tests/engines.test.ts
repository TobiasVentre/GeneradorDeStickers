import test from "node:test";
import assert from "node:assert/strict";

import { imposeFromSpec } from "../application/usecases/imposeFolder";
import {
  ALGO_GRID_V1,
  ALGO_SHELF_MIXED_V1,
  DEFAULT_ALGO_VERSION,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  ExecutionSpec,
  defaultExecutionSheet,
  defaultStickerSizing,
} from "../domain/models";
import type { CatalogPort, PngAssetInfo } from "../application/ports";

const baseAssets: PngAssetInfo[] = [
  { assetId: "a.png", filePath: "C:\\tmp\\a.png", widthPx: 1000, heightPx: 500 },
  { assetId: "b.png", filePath: "C:\\tmp\\b.png", widthPx: 1000, heightPx: 500 },
];

function makeCatalog(assets: PngAssetInfo[]): CatalogPort {
  return {
    async listPngAssets(_folderPath: string): Promise<PngAssetInfo[]> {
      return assets;
    },
  };
}

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

test("Selecciona motor por algoVersion (grid)", async () => {
  const spec = buildSpec({ algoVersion: ALGO_GRID_V1 });
  const catalog = makeCatalog(baseAssets);
  const result = await imposeFromSpec({ catalog, spec });
  assert.equal(result.job.engineId, ALGO_GRID_V1);
  assert.ok(result.job.layout, "El motor grid debe generar layout");
});

test("Selecciona motor por algoVersion (shelf mixed)", async () => {
  const spec = buildSpec({
    algoVersion: ALGO_SHELF_MIXED_V1,
    stickerSizing: { mode: "perAsset" },
    quantities: [
      { assetId: "a.png", qty: 2, sizing: { mode: "physical", axis: "w", sizeCm: 5 } },
      { assetId: "b.png", qty: 3, sizing: { mode: "physical", axis: "h", sizeCm: 4 } },
    ],
  });
  const catalog = makeCatalog(baseAssets);
  const result = await imposeFromSpec({ catalog, spec });
  assert.equal(result.job.engineId, ALGO_SHELF_MIXED_V1);
  assert.equal(result.job.layout, undefined);
});

test("Motor mixed valida stickerSizing=perAsset", async () => {
  const spec = buildSpec({
    algoVersion: ALGO_SHELF_MIXED_V1,
    stickerSizing: { mode: "fromImageDpi" },
  });
  const catalog = makeCatalog(baseAssets);

  await assert.rejects(
    () => imposeFromSpec({ catalog, spec }),
    (err: unknown) => {
      return err instanceof Error && err.message.includes("stickerSizing.mode=perAsset");
    }
  );
});

test("Motor grid rechaza assets con tamanos distintos", async () => {
  const mixedAssets: PngAssetInfo[] = [
    { assetId: "a.png", filePath: "C:\\tmp\\a.png", widthPx: 1000, heightPx: 500 },
    { assetId: "b.png", filePath: "C:\\tmp\\b.png", widthPx: 1200, heightPx: 500 },
  ];
  const spec = buildSpec({ algoVersion: ALGO_GRID_V1 });
  const catalog = makeCatalog(mixedAssets);

  await assert.rejects(
    () => imposeFromSpec({ catalog, spec }),
    (err: unknown) => {
      return err instanceof Error && err.message.includes("Tamanos distintos detectados");
    }
  );
});

test("Falla si algoVersion no esta registrado", async () => {
  const spec = buildSpec({ algoVersion: "no-existe" });
  const catalog = makeCatalog(baseAssets);

  await assert.rejects(
    () => imposeFromSpec({ catalog, spec }),
    (err: unknown) => {
      return err instanceof Error && err.message.includes("Motor no registrado");
    }
  );
});
