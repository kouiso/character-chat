#!/usr/bin/env node
// Versions 板は状態を縦に積んだ長尺画像で、下固定の帯・シートだけ圧縮して描かれている。
// ここでは板のピクセルだけを 390×844 の実 viewport へ並べ直し、実装画像と横に並べる。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SCALE = 2;
const PANEL_WIDTH = 390;
const PANEL_HEIGHT = 844;
const GAP = 12;
const ROOT = process.cwd();
const DESIGN_PATH = path.join(ROOT, "doc/design/v2/screenshot/Versions.jpg");
const EVIDENCE_DIR = path.join(ROOT, "doc/evidence/2026-11-22/versions");
const OUT_DIR = path.join(EVIDENCE_DIR, "cmp");

// Versions.jpg 内の状態の先頭（CSS px）。板の section 帯 40px は含めない。
const STATE_TOP = {
  normal: 40,
  confirm: 1844,
  restoring: 2484,
  restoreFail: 3124,
  restored: 3360,
  currentSelected: 3920,
  empty: 4380,
  many: 4760,
  loading: 5232,
  detailNotfound: 5560,
  listError: 5804,
  detailError: 6048,
};

const px = (value) => Math.round(value * SCALE);

const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px(PANEL_WIDTH)}" height="${px(PANEL_HEIGHT)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0E1425"/><stop offset="0.46" stop-color="#10162A"/>
    <stop offset="0.78" stop-color="#191826"/><stop offset="1" stop-color="#231B20"/>
  </linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>
</svg>`;

const scrimSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px(PANEL_WIDTH)}" height="${px(PANEL_HEIGHT)}"><rect width="100%" height="100%" fill="rgba(6,8,16,0.6)"/></svg>`;

const cropDesign = async ({ top, height, width = PANEL_WIDTH, left = 0 }) =>
  sharp(DESIGN_PATH)
    .extract({ left: px(left), top: px(top), width: px(width), height: px(height) })
    .png()
    .toBuffer();

const composePanel = async (operations) => {
  const composites = [];
  for (const operation of operations) {
    if (operation.type === "scrim") {
      composites.push({ input: Buffer.from(scrimSvg), left: 0, top: 0 });
      continue;
    }
    composites.push({
      input: await cropDesign(operation),
      left: px(operation.left ?? 0),
      top: px(operation.at),
    });
  }
  return sharp(Buffer.from(gradientSvg)).composite(composites).png().toBuffer();
};

const part = (state, offset, height, at, extra = {}) => ({
  top: STATE_TOP[state] + offset,
  height,
  at,
  ...extra,
});

// 板の通常状態は内容を全部展開した 1764px の絵。実 viewport では本文がscrollし、
// 下の帯は見えたままなので、先頭 760px と帯 84px を 844px へ並べ直す。
const normalPanel = async () =>
  composePanel([part("normal", 0, 760, 0), part("normal", 1680, 84, 760)]);

const sheetPanel = async (state) => {
  const normal = await normalPanel();
  // normal の上へ scrim をかけ、板のシートだけを下端へ移す。
  return sharp(normal)
    .composite([
      { input: Buffer.from(scrimSvg), left: 0, top: 0 },
      {
        input: await cropDesign({
          top: STATE_TOP[state] + 384,
          height: 216,
        }),
        left: 0,
        top: px(PANEL_HEIGHT - 216),
      },
    ])
    .png()
    .toBuffer();
};

const spacerPanel = async (state, contentHeight, barOffset, barHeight, extras = []) => {
  const operations = [
    part(state, 0, contentHeight, 0),
    part(state, barOffset, barHeight, PANEL_HEIGHT - barHeight),
    ...extras,
  ];
  return composePanel(operations);
};

const panels = {
  normal: normalPanel,
  confirm: () => sheetPanel("confirm"),
  restoring: () => sheetPanel("restoring"),
  restoreFail: () =>
    composePanel([
      part("normal", 0, 56, 0),
      part("restoreFail", 0, 112, 56),
      part("restoreFail", 112, 84, PANEL_HEIGHT - 84),
    ]),
  restored: () =>
    spacerPanel("restored", 340, 464, 56, [
      // toast は板どおり下端から 72px の位置へ置く。
      part("restored", 396, 52, PANEL_HEIGHT - 72 - 52),
    ]),
  currentSelected: () => spacerPanel("currentSelected", 288, 364, 56),
  empty: () => spacerPanel("empty", 184, 284, 56),
  many: () => composePanel([part("many", 0, 432, 0)]),
  loading: () => composePanel([part("loading", 0, 288, 0)]),
  detailNotfound: () => composePanel([part("detailNotfound", 0, 204, 0)]),
  listError: () => composePanel([part("listError", 0, 204, 0)]),
  detailError: () => composePanel([part("detailError", 0, 212, 0)]),
};

const comparisons = [
  ["normal", "01-normal.png", "normal"],
  ["current-selected", "02-current-selected.png", "currentSelected"],
  ["confirm", "03-confirm.png", "confirm"],
  ["restored", "04-restored.png", "restored"],
  ["empty", "05-empty.png", "empty"],
  ["many-collapsed", "06-many-collapsed.png", "many"],
  ["many-expanded", "07-many-expanded.png", "many"],
  ["detail-loading", "08-detail-loading.png", "loading"],
  ["detail-error", "09-detail-error.png", "detailError"],
  ["detail-notfound", "10-detail-notfound.png", "detailNotfound"],
  ["restore-fail", "11-restore-fail.png", "restoreFail"],
  ["list-loading", "12-list-loading.png", "loading"],
  ["list-error", "13-list-error.png", "listError"],
  ["conflict", "14-conflict.png", "confirm"],
  ["draft-removal-failure", "15-draft-removal-failure.png", "restored"],
  ["restoring", "16-restoring.png", "restoring"],
];

const resizePanel = (input) =>
  sharp(input).resize(PANEL_WIDTH, PANEL_HEIGHT, { fit: "fill" }).png().toBuffer();

await mkdir(OUT_DIR, { recursive: true });
const manifest = [];
for (const [name, implementationFile, panelKey] of comparisons) {
  const implementationPath = path.join(EVIDENCE_DIR, implementationFile);
  const [designPanel, implementationPanel] = await Promise.all([
    panels[panelKey]().then(resizePanel),
    resizePanel(implementationPath),
  ]);
  const output = sharp({
    create: {
      width: PANEL_WIDTH * 2 + GAP,
      height: PANEL_HEIGHT,
      channels: 4,
      background: "#181820",
    },
  }).composite([
    { input: designPanel, left: 0, top: 0 },
    { input: implementationPanel, left: PANEL_WIDTH + GAP, top: 0 },
  ]);
  const outPath = path.join(OUT_DIR, `cmp-${name}.png`);
  await output.png().toFile(outPath);
  manifest.push({
    file: `cmp-${name}.png`,
    implementation: implementationFile,
    boardPanel: panelKey,
  });
  console.log(`${outPath}: left=board(${panelKey}) right=${implementationFile}`);
}
await writeFile(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify({ viewport: "390x844 CSS px", scaleCaptured: 2, gap: GAP, comparisons: manifest }, null, 2)}\n`,
);
