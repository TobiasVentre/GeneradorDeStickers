import {
  DEFAULT_ALGO_VERSION,
  DEFAULT_DPI,
  DEFAULT_EXECUTION_SPEC_VERSION,
  ExecutionSpec,
  ExecutionSpecItem,
  ImpositionJob,
  createSheetSpec,
  defaultExecutionSheet,
} from "../../domain/models";
import { CatalogPort, PngAssetInfo } from "../ports";
import { resolveEngine } from "../engines";
import { GridImpositionEngine } from "../engines/gridEngine";
import { ShelfMixedImpositionEngine } from "../engines/shelfMixedEngine";

export interface ImposeFolderParams {
  folderPath: string;
  sheetWcm?: number; // default 100
  sheetHcm?: number; // default 50
  gapMm?: number; // default 3
  marginMm?: number; // default 0
  dpi?: number; // default 300 (FORZADO)
  quantities: ExecutionSpecItem[];
  catalog: CatalogPort;
}

export interface ImposeFromSpecParams {
  catalog: CatalogPort;
  spec: ExecutionSpec;
}

export interface ImposeFolderResult {
  job: ImpositionJob;
  assets: PngAssetInfo[];
  totalPlaced: number;
  totalPages: number;
}

const DEFAULT_ENGINES = [new GridImpositionEngine(), new ShelfMixedImpositionEngine()];

function toExecutionSpec(params: ImposeFolderParams): ExecutionSpec {
  const sheetDefaults = defaultExecutionSheet();
  return {
    specVersion: DEFAULT_EXECUTION_SPEC_VERSION,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    folderPath: params.folderPath,
    dpi: params.dpi ?? DEFAULT_DPI,
    sheet: {
      wCm: params.sheetWcm ?? sheetDefaults.wCm,
      hCm: params.sheetHcm ?? sheetDefaults.hCm,
      gapMm: params.gapMm ?? sheetDefaults.gapMm,
      marginMm: params.marginMm ?? sheetDefaults.marginMm,
    },
    stickerSizing: { mode: "fromImageDpi" },
    quantities: params.quantities.map((q) => ({ assetId: q.assetId, qty: q.qty, sizing: q.sizing })),
    algoVersion: DEFAULT_ALGO_VERSION,
  };
}

export async function imposeFromSpec(params: ImposeFromSpecParams): Promise<ImposeFolderResult> {
  const { spec, catalog } = params;

  const sheet = createSheetSpec({
    sheetWcm: spec.sheet.wCm,
    sheetHcm: spec.sheet.hCm,
    gapMm: spec.sheet.gapMm,
    marginMm: spec.sheet.marginMm,
  });

  const assets = (await catalog.listPngAssets(spec.folderPath)).slice().sort((a, b) => {
    return a.assetId.localeCompare(b.assetId);
  });

  if (assets.length === 0) throw new Error("No se encontraron PNGs en la carpeta.");

  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const missing = spec.quantities.filter((q) => q.qty > 0 && !byId.has(q.assetId));
  if (missing.length > 0) {
    throw new Error(`CSV/Spec invalido: faltan PNGs en carpeta: ${missing.map((m) => m.assetId).join(", ")}`);
  }

  const engine = resolveEngine(spec.algoVersion, DEFAULT_ENGINES);
  const planned = engine.plan({ spec, assets, sheet });

  return {
    job: planned.job,
    assets,
    totalPlaced: planned.totalPlaced,
    totalPages: planned.totalPages,
  };
}

export async function imposeFolder(params: ImposeFolderParams): Promise<ImposeFolderResult> {
  const spec = toExecutionSpec(params);
  return imposeFromSpec({ catalog: params.catalog, spec });
}
