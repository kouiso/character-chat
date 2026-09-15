#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";

const [refPath, shotPath] = process.argv.slice(2);
if (!refPath || !shotPath) {
  console.error("Usage: node script/design/compare.mjs <design-ref.png> <app-shot.png>");
  process.exit(2);
}

const readPng = async (filePath) => {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = new PNG({ width: info.width, height: info.height });
  image.data = data;
  return image;
};
const ref = await readPng(refPath);
const shot = await readPng(shotPath);
const width = Math.max(ref.width, shot.width);
const height = Math.max(ref.height, shot.height);

const pad = (source) => {
  const image = new PNG({ width, height, fill: true });
  PNG.bitblt(source, image, 0, 0, source.width, source.height, 0, 0);
  return image;
};

const refPadded = pad(ref);
const shotPadded = pad(shot);
const diff = new PNG({ width, height });
const diffPixels = pixelmatch(refPadded.data, shotPadded.data, diff.data, width, height, {
  threshold: 0.1,
});
const ratio = diffPixels / (width * height);

const side = new PNG({ width: width * 3, height, fill: true });
PNG.bitblt(refPadded, side, 0, 0, width, height, 0, 0);
PNG.bitblt(shotPadded, side, 0, 0, width, height, width, 0);
PNG.bitblt(diff, side, 0, 0, width, height, width * 2, 0);

const name = `${path.basename(refPath, path.extname(refPath))}-vs-${path.basename(
  shotPath,
  path.extname(shotPath),
)}`;
const outDir = process.env.DESIGN_DIFF_OUT_DIR
  ? path.resolve(process.env.DESIGN_DIFF_OUT_DIR)
  : path.join(process.cwd(), ".work", "design-audit");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `${name}.side.png`);
writeFileSync(outPath, PNG.sync.write(side));
console.log(
  `reference=${ref.width}x${ref.height} actual=${shot.width}x${shot.height} ` +
    `diffPixels=${diffPixels} diffRatio=${ratio.toFixed(6)} output=${outPath}`,
);
