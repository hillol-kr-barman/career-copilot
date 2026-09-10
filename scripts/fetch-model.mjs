#!/usr/bin/env node
/**
 * Build-time asset fetcher for the Phase 5 in-browser transcriber.
 *
 * Mirrors two things into `public/` so the app never fetches them from a
 * third-party origin at runtime (LIVE-10's "no upload" claim has to be
 * literally true, not true-except-for-the-model):
 *
 *   1. The `onnx-community/whisper-base-ONNX` q8 ("quantized") snapshot,
 *      pinned to a commit SHA rather than `main` — a moved branch pointer is
 *      exactly the supply-chain risk (T-05-02) a pinned commit forecloses.
 *      (05-07 engine-fix: originally q4f16; superseded — see the comment on
 *      `ONNX_FILES` below and 05-07-ENGINE-FIX-SUMMARY.md.)
 *   2. The onnxruntime-web WASM runtime, pinned to the STABLE `1.24.3` via
 *      package.json's `overrides` (05-07 engine-fix — the nightly build
 *      `@huggingface/transformers@4.2.0` pins broke quantized Whisper
 *      decoders), copied out of the installed `onnxruntime-web` package
 *      rather than left to resolve from its default CDN, which would punch
 *      a hole through `connect-src: 'self'` on first run (T-05-07).
 *
 * Idempotent: a file already on disk at its declared byte size is skipped,
 * never re-downloaded or re-copied. `npm run build` runs this via the
 * `prebuild` hook on every build, local or Render, so a warm disk must not
 * pay the ~88 MB cost twice.
 */

import { createRequire } from "node:module";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Pinned commit for onnx-community/whisper-base-ONNX. Every URL below is
// built from this constant, never from `main` — a branch pointer can move
// under a later deploy, a commit SHA cannot (T-05-02).
const MODEL_REVISION = "e2227b9835949f10a62424b0a84b5ed5b62e1267";
const MODEL_REPO = "onnx-community/whisper-base-ONNX";
const MODEL_DEST_DIR = join(projectRoot, "public", "models", MODEL_REPO);
const ORT_DEST_DIR = join(projectRoot, "public", "ort");

/** @type {Array<{ path: string; bytes: number }>} */
const ROOT_FILES = [
  { path: "added_tokens.json", bytes: 34604 },
  { path: "config.json", bytes: 1409 },
  { path: "generation_config.json", bytes: 3832 },
  { path: "merges.txt", bytes: 493869 },
  { path: "normalizer.json", bytes: 52666 },
  { path: "preprocessor_config.json", bytes: 339 },
  { path: "quantize_config.json", bytes: 312 },
  { path: "special_tokens_map.json", bytes: 2194 },
  { path: "tokenizer.json", bytes: 3930494 },
  { path: "tokenizer_config.json", bytes: 282713 },
  { path: "vocab.json", bytes: 1036584 },
];

// 05-07 engine-fix: the q4f16 pair below was replaced with the int8
// ("quantized") pair at the SAME pinned revision. q4f16 (WebGPU) and the
// then-current nightly onnxruntime-web returned garbage output
// (" I" / " I I I And") against a known-good speech sample in real-browser
// testing; the only verified-correct configuration on this model+runtime
// stack is q8 (filenames "*_quantized.onnx") + onnxruntime-web 1.24.3 (see
// the `overrides` entry in package.json) + device "wasm". See
// src/workers/whisper.worker.ts's MODEL_DTYPE comment and 05-07-ENGINE-FIX-
// SUMMARY.md for the full evidence. `npm run check` asserts this filename
// suffix and the worker's MODEL_DTYPE name the same quantization.
/** @type {Array<{ path: string; bytes: number }>} */
const ONNX_FILES = [
  { path: "onnx/encoder_model_quantized.onnx", bytes: 23123021 },
  { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 158950475 },
];

function modelUrl(relativePath) {
  return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${relativePath}`;
}

/**
 * Downloads (or skips, if already present at the expected byte size) one
 * model file. Fails loudly on a size mismatch — a short or truncated file
 * must never be allowed to become a silent runtime 404.
 */
async function fetchModelFile({ path: relativePath, bytes: expectedBytes }) {
  const destPath = join(MODEL_DEST_DIR, relativePath);

  const existing = await statOrNull(destPath);
  if (existing && existing.size === expectedBytes) {
    console.log(`[fetch-model] skip (already present): ${relativePath}`);
    return;
  }

  console.log(`[fetch-model] downloading: ${relativePath}`);
  const url = modelUrl(relativePath);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[fetch-model] FAILED to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `[fetch-model] FAILED size check for ${relativePath}: expected ${expectedBytes} bytes, got ${buffer.byteLength}. ` +
        `A short or truncated download must not be written to disk — the model revision or expected size table may be stale.`
    );
  }

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  console.log(`[fetch-model] downloaded: ${relativePath} (${buffer.byteLength} bytes)`);
}

/**
 * Resolves the installed `onnxruntime-web` package's directory. 05-07
 * engine-fix pinned `onnxruntime-web@1.24.3` via a top-level npm `overrides`
 * entry in `package.json` (the nightly build `@huggingface/transformers@4.2.0`
 * pins directly returned garbage transcription output in real-browser
 * testing — see 05-07-ENGINE-FIX-SUMMARY.md). Critically, with that override
 * npm installs the package NESTED at
 * `node_modules/@huggingface/transformers/node_modules/onnxruntime-web`, NOT
 * hoisted to the project root's `node_modules/onnxruntime-web` — so a plain
 * `require.resolve("onnxruntime-web")` rooted at THIS script (project root)
 * fails to find it. Resolve it the way Node actually would when
 * `@huggingface/transformers` itself imports `onnxruntime-web` — i.e. rooted
 * at the transformers package — falling back to a root-rooted resolution for
 * any future state where npm does hoist it. Fails loudly, printing the
 * resolved version, if neither location can be found.
 */
function resolveOnnxRuntimeWebDistDir() {
  // "onnxruntime-web/package.json" is not resolvable in either location —
  // the package's "exports" map does not expose that subpath. Resolving the
  // bare specifier instead lands on a file inside its dist/ directory (which
  // holds every build artifact — node, browser, wasm, mjs — side by side),
  // so dirname() of that file is the dist/ directory we need.
  const attempts = [];

  // Attempt 1: resolve exactly as @huggingface/transformers itself would —
  // rooted at that package's own location, so Node's module resolution walks
  // ITS node_modules first and finds the nested, overridden 1.24.3 install.
  try {
    const transformersRequire = createRequire(
      join(projectRoot, "node_modules", "@huggingface", "transformers", "package.json")
    );
    const entryPath = transformersRequire.resolve("onnxruntime-web");
    return dirname(entryPath);
  } catch (err) {
    attempts.push(`nested (via @huggingface/transformers): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Attempt 2: root-rooted resolution, in case a future npm/lockfile state
  // hoists the package to the project root instead of nesting it.
  try {
    const rootRequire = createRequire(import.meta.url);
    const entryPath = rootRequire.resolve("onnxruntime-web");
    return dirname(entryPath);
  } catch (err) {
    attempts.push(`hoisted (project root): ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(
    `[fetch-model] FAILED to resolve the onnxruntime-web package in either its nested location ` +
      `(node_modules/@huggingface/transformers/node_modules/onnxruntime-web) or the hoisted project root ` +
      `(node_modules/onnxruntime-web). Is @huggingface/transformers installed, and does package.json's ` +
      `"overrides"."onnxruntime-web" entry still say "1.24.3"? Attempts:\n  - ${attempts.join("\n  - ")}`
  );
}

/**
 * Copies every `*.wasm` and `*.mjs` file out of the installed
 * `onnxruntime-web` package's `dist/` directory into `public/ort/` (flat, no
 * subdirectories). The plan 05-03 worker points
 * `env.backends.onnx.wasm.wasmPaths` at `/ort/`. Fails loudly if the package
 * cannot be resolved or if zero matching files are found — a silent
 * zero-file copy is the failure mode that only shows up in production.
 */
async function copyOnnxRuntimeWasm() {
  const ortDistDir = resolveOnnxRuntimeWebDistDir();

  // Report the resolved version so a mismatch against the pinned 1.24.3 is
  // visible immediately rather than discovered only via broken transcription
  // in the browser.
  try {
    const ortPackageJsonPath = join(dirname(ortDistDir), "package.json");
    const ortPackageJson = JSON.parse(await readFile(ortPackageJsonPath, "utf8"));
    console.log(`[fetch-model] onnxruntime-web resolved: version ${ortPackageJson.version} at ${ortDistDir}`);
  } catch {
    console.log(`[fetch-model] onnxruntime-web resolved at ${ortDistDir} (version lookup failed, non-fatal)`);
  }

  let entries;
  try {
    entries = await readdir(ortDistDir);
  } catch (err) {
    throw new Error(
      `[fetch-model] FAILED to read onnxruntime-web's dist/ directory at ${ortDistDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const runtimeFiles = entries.filter((name) => name.endsWith(".wasm") || name.endsWith(".mjs"));
  if (runtimeFiles.length === 0) {
    throw new Error(
      `[fetch-model] FAILED: onnxruntime-web's dist/ directory at ${ortDistDir} contains zero .wasm/.mjs files. ` +
        `A silent zero-file copy would only surface as a production 404 — treating this as a hard failure instead.`
    );
  }

  await mkdir(ORT_DEST_DIR, { recursive: true });

  for (const name of runtimeFiles) {
    const srcPath = join(ortDistDir, name);
    const destPath = join(ORT_DEST_DIR, name);
    const srcStat = await stat(srcPath);
    const existing = await statOrNull(destPath);
    if (existing && existing.size === srcStat.size) {
      console.log(`[fetch-model] skip (already present): ort/${name}`);
      continue;
    }
    const { copyFile } = await import("node:fs/promises");
    await copyFile(srcPath, destPath);
    console.log(`[fetch-model] copied: ort/${name} (${srcStat.size} bytes)`);
  }
}

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`[fetch-model] model revision: ${MODEL_REVISION}`);

  for (const file of ROOT_FILES) {
    await fetchModelFile(file);
  }
  for (const file of ONNX_FILES) {
    await fetchModelFile(file);
  }

  await copyOnnxRuntimeWasm();

  console.log("[fetch-model] done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
