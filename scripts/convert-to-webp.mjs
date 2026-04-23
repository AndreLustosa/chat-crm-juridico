#!/usr/bin/env node
// Converte PNG/JPG em apps/web/public/landing/ (e subpastas) para .webp.
// Mantem originais. Nao reprocessa arquivos que ja tem .webp irmao.
//
// Uso:
//   node scripts/convert-to-webp.mjs
//
// Heuristica de qualidade:
//   - Logos/icones com transparencia (detectado via alpha channel ou nome "logo"/"icon"):
//       quality: 90, effort: 6
//   - Demais (fotos/backgrounds):
//       quality: 82, effort: 6

import { readdir, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TARGET_DIR = resolve(ROOT, "apps/web/public/landing");

const RAW_EXT = new Set([".png", ".jpg", ".jpeg"]);

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function webpSibling(file) {
  const ext = extname(file);
  return file.slice(0, -ext.length) + ".webp";
}

function isLogoLike(name, hasAlpha) {
  const n = name.toLowerCase();
  if (n.includes("logo") || n.includes("icon") || n.startsWith("img_")) return true;
  if (n === "caneta.png" || n === "justice.png" || n === "bandeiras_sem_fundo.png") return true;
  return hasAlpha === true;
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  console.log(`Scanning: ${TARGET_DIR}\n`);

  const allFiles = await walk(TARGET_DIR);
  const candidates = allFiles.filter((f) => RAW_EXT.has(extname(f).toLowerCase()));

  const results = {
    converted: [],
    skipped: [],
    errors: [],
  };

  let totalIn = 0;
  let totalOut = 0;

  for (const src of candidates) {
    const dst = webpSibling(src);
    const rel = src.replace(ROOT + "\\", "").replace(ROOT + "/", "");

    if (await exists(dst)) {
      results.skipped.push(rel);
      continue;
    }

    try {
      const inStat = await stat(src);
      const img = sharp(src);
      const meta = await img.metadata();
      const hasAlpha = Boolean(meta.hasAlpha);
      const logoLike = isLogoLike(src.split(/[\\/]/).pop(), hasAlpha);

      const opts = logoLike
        ? { quality: 90, lossless: false, effort: 6, alphaQuality: 100 }
        : { quality: 82, effort: 6 };

      await img.webp(opts).toFile(dst);

      const outStat = await stat(dst);
      totalIn += inStat.size;
      totalOut += outStat.size;

      results.converted.push({
        file: rel,
        mode: logoLike ? "logo(q=90)" : "photo(q=82)",
        before: inStat.size,
        after: outStat.size,
        saved: inStat.size - outStat.size,
      });
    } catch (err) {
      results.errors.push({ file: rel, error: err.message });
    }
  }

  console.log("─".repeat(80));
  console.log(`CONVERTIDOS: ${results.converted.length}`);
  console.log("─".repeat(80));
  for (const r of results.converted) {
    const pct = r.before > 0 ? ((r.saved / r.before) * 100).toFixed(1) : "0";
    console.log(
      `  ${r.mode.padEnd(14)} ${r.file.padEnd(55)} ${fmtBytes(r.before).padStart(9)} → ${fmtBytes(r.after).padStart(9)}  (-${pct}%)`,
    );
  }

  if (results.skipped.length) {
    console.log(`\n─${"─".repeat(79)}`);
    console.log(`PULADOS (ja tinham .webp): ${results.skipped.length}`);
    console.log("─".repeat(80));
    for (const f of results.skipped) console.log(`  ${f}`);
  }

  if (results.errors.length) {
    console.log(`\n─${"─".repeat(79)}`);
    console.log(`ERROS: ${results.errors.length}`);
    console.log("─".repeat(80));
    for (const e of results.errors) console.log(`  ${e.file}: ${e.error}`);
  }

  console.log(`\n─${"─".repeat(79)}`);
  console.log("TOTAIS");
  console.log("─".repeat(80));
  console.log(`  Entrada : ${fmtBytes(totalIn)}`);
  console.log(`  Saida   : ${fmtBytes(totalOut)}`);
  const saved = totalIn - totalOut;
  const pct = totalIn > 0 ? ((saved / totalIn) * 100).toFixed(1) : "0";
  console.log(`  Economia: ${fmtBytes(saved)} (-${pct}%)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
