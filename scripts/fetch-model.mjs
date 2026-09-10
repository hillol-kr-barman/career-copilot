#!/usr/bin/env node
/**
 * Build-time asset fetcher for the Phase 5 in-browser transcriber.
 *
 * Mirrors two things into `public/` so the app never fetches them from a
 * third-party origin at runtime (LIVE-10's "no upload" claim has to be
 * literally true, not true-except-for-the-model):
 *
 *   1. The `onnx-community/whisper-base-ONNX` q4f16 snapshot, pinned to a
 *      commit SHA rather than `main` — a moved branch pointer is exactly the
 *      supply-chain risk (T-05-02) a pinned commit forecloses.
 *   2. The onnxruntime-web WASM runtime, copied out of the installed
 *      `onnxruntime-web` package (a transitive dependency of
 *      `@huggingface/transformers`) rather than left to resolve from its
 *      default CDN, which would punch a hole through `connect-src: 'self'`
 *      on first run (T-05-07).
 *
 * Idempotent: a file already on disk at its declared byte size is skipped,
 * never re-downloaded or re-copied. `npm run build` runs this via the
 * `prebuild` hook on every build, local or Render, so a warm disk must not
 * pay the ~88 MB cost twice.
 */

import { createRequire } from "node:module";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
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

/** @type {Array<{ path: string; bytes: number }>} */
const ONNX_FILES = [
  { path: "onnx/encoder_model_q4f16.onnx", bytes: 14127819 },
  { path: "onnx/decoder_model_merged_q4f16.onnx", bytes: 68288623 },
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
 * Copies every `*.wasm` and `*.mjs` file out of the installed
 * `onnxruntime-web` package's `dist/` directory into `public/ort/` (flat, no
 * subdirectories). The plan 05-03 worker points
 * `env.backends.onnx.wasm.wasmPaths` at `/ort/`. Fails loudly if the package
 * cannot be resolved or if zero matching files are found — a silent
 * zero-file copy is the failure mode that only shows up in production.
 */
async function copyOnnxRuntimeWasm() {
  const require = createRequire(import.meta.url);
  let entryPath;
  try {
    // "onnxruntime-web/package.json" is not resolvable — the package's
    // "exports" map does not expose that subpath. Resolving the bare
    // specifier instead lands on a file inside its dist/ directory (which
    // holds every build artifact — node, browser, wasm, mjs — side by
    // side), so dirname() of that file is the dist/ directory we need.
    entryPath = require.resolve("onnxruntime-web");
  } catch (err) {
    throw new Error(
      `[fetch-model] FAILED to resolve the onnxruntime-web package — is @huggingface/transformers installed? (${err instanceof Error ? err.message : String(err)})`
    );
  }
  const ortDistDir = dirname(entryPath);

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
