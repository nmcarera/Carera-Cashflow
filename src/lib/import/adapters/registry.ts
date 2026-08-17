/**
 * Adapter registry. Adding a new institution means writing one adapter file
 * (see abnAmro.ts / amexEu.ts / chaseUs.ts for the shape) and adding it to
 * `ADAPTERS` below — nothing else in the import pipeline changes.
 */
import type { InspectedFile } from "../fileInspector";
import type { InstitutionAdapter } from "./types";
import { abnAmroAdapter } from "./abnAmro";
import { amexEuAdapter } from "./amexEu";
import { chaseUsAdapter, UNVERIFIED as CHASE_UNVERIFIED } from "./chaseUs";

export const ADAPTERS: InstitutionAdapter[] = [abnAmroAdapter, amexEuAdapter, chaseUsAdapter];

export const UNVERIFIED_ADAPTER_IDS = new Set<string>(CHASE_UNVERIFIED ? [chaseUsAdapter.id] : []);

const DETECTION_THRESHOLD = 0.5;

export interface DetectedAdapter {
  adapter: InstitutionAdapter;
  confidence: number;
  reason: string;
}

/** Returns every adapter that's at least somewhat confident it recognizes
 *  this file, most confident first. An empty array means "unrecognized
 *  format" — the import pipeline must fail safely rather than guess (build
 *  brief §2). */
export function detectAdapters(file: InspectedFile): DetectedAdapter[] {
  return ADAPTERS.map((adapter) => ({ adapter, ...adapter.detect(file) }))
    .filter((d) => d.confidence >= DETECTION_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);
}

export function getAdapterById(id: string): InstitutionAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
