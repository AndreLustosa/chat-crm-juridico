// Otimiza heros de landing pages: PNG pesado -> WebP responsivo (desktop + mobile).
// Mantém os PNGs originais intactos (usados em OG/JSON-LD). Idempotente.
//
// Uso:
//   node scripts/optimize-landing-heroes.mjs            # processa todos os heros do manifesto
//   node scripts/optimize-landing-heroes.mjs criminal-hero-andre-lustosa  # só os informados
//
// Estratégia: desktop <=1600px e mobile <=800px, qualidade auto-reduzida (80->60)
// até cada arquivo ficar < 150 KB. Não amplia imagens menores que o alvo.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.resolve(__dirname, "../public/landing");
const MAX_BYTES = 150 * 1024;
const QUALITY_STEPS = [80, 76, 72, 68, 64, 60];

// Cada hero gera <base>.webp (desktop) e <base>-mobile.webp.
const HEROES = [
  "criminal-hero-andre-lustosa",
  "medidas-protetivas-arapiraca-hero",
  "defesa-homem-maria-da-penha-hero",
  "verbas-rescisorias-hero",
  "contrato-experiencia-hero",
  "rescisao-indireta-hero",
  "justa-causa-hero",
  "rescisao-por-acordo-hero",
  "pedido-demissao-hero",
  "reconhecimento-vinculo-hero",
  "sem_carteira_hero_bg",
];

const VARIANTS = [
  { suffix: "", maxWidth: 1600 },
  { suffix: "-mobile", maxWidth: 800 },
];

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function findSource(base) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const p = path.join(LANDING_DIR, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function buildVariant(srcPath, outPath, maxWidth) {
  const meta = await sharp(srcPath).metadata();
  const targetWidth = Math.min(maxWidth, meta.width || maxWidth);
  let last = null;
  for (const quality of QUALITY_STEPS) {
    const buf = await sharp(srcPath)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toBuffer();
    last = { buf, quality };
    if (buf.length <= MAX_BYTES) break;
  }
  fs.writeFileSync(outPath, last.buf);
  return { bytes: last.buf.length, quality: last.quality, width: targetWidth };
}

async function main() {
  const argv = process.argv.slice(2);
  const targets = argv.length ? argv : HEROES;
  const rows = [];

  for (const base of targets) {
    const src = findSource(base);
    if (!src) {
      rows.push({ name: base, status: "FONTE NÃO ENCONTRADA" });
      continue;
    }
    const srcBytes = fs.statSync(src).size;
    for (const { suffix, maxWidth } of VARIANTS) {
      const outPath = path.join(LANDING_DIR, `${base}${suffix}.webp`);
      const r = await buildVariant(src, outPath, maxWidth);
      rows.push({
        name: `${base}${suffix}.webp`,
        from: fmtKB(srcBytes),
        to: fmtKB(r.bytes),
        q: r.quality,
        w: r.width,
        ok: r.bytes <= MAX_BYTES,
      });
    }
  }

  console.log("\n  arquivo".padEnd(52) + "origem".padEnd(10) + "webp".padEnd(10) + "q   largura  <150KB");
  console.log("  " + "-".repeat(86));
  for (const r of rows) {
    if (r.status) {
      console.log("  " + r.name.padEnd(50) + r.status);
      continue;
    }
    console.log(
      "  " +
        r.name.padEnd(50) +
        String(r.from).padEnd(10) +
        String(r.to).padEnd(10) +
        String(r.q).padEnd(4) +
        String(r.w + "px").padEnd(8) +
        (r.ok ? " ✓" : " ✗ ACIMA"),
    );
  }
  const over = rows.filter((r) => r.ok === false);
  console.log("\n  " + rows.filter((r) => r.ok).length + " variantes OK, " + over.length + " acima de 150KB.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
