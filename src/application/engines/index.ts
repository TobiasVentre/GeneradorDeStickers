import type { ExecutionSpec, ImpositionJob, SheetSpec } from "../../domain/models";
import type { PngAssetInfo } from "../ports";

export interface EnginePlanParams {
  spec: ExecutionSpec;
  assets: PngAssetInfo[];
  sheet: SheetSpec;
}

export interface EnginePlanResult {
  job: ImpositionJob;
  totalPlaced: number;
  totalPages: number;
}

export interface ImpositionEngine {
  readonly id: string;
  plan(params: EnginePlanParams): EnginePlanResult;
}

export function resolveEngine(algoVersion: string, engines: ImpositionEngine[]): ImpositionEngine {
  const engine = engines.find((e) => e.id === algoVersion);
  if (!engine) {
    throw new Error(`Motor no registrado: ${algoVersion}`);
  }
  return engine;
}
