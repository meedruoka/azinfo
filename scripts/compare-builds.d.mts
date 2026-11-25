// Types for scripts/compare-builds.mjs (plain JavaScript so it runs with node, no build step).

export declare const STORE_MANIFEST_FIELDS: string[];
export declare function listFiles(dir: string): string[];
export declare function normaliseManifest(text: string): string;
export declare function compareBuilds(
  releaseDir: string,
  installedDir: string,
): { compared: number; onlyInRelease: string[]; onlyInstalled: string[]; different: string[] };
