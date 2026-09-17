// Phase 1 レポートを単一 HTML に生成する。transcript 本文を埋め込むので
// .work/report/ 配下（gitignore 済み）にだけ出す。公開 git には入らん。
//
// 使い方: node script/verify/report-html.mjs
//   → .work/report/index.html を書き出す
//
// 2026-09-17: 芯チェック（【プレイヤーへの約束】）セクションを追加。
// パターンは packages/judge/src/fantasy-core-check.ts と同じ項目名で集計する。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RESULTS = join(root, ".work/e2e-results/vlong-dogfood");
const OUT = join(root, ".work/report");
mkdirSync(OUT, { recursive: true });

const BODY_MARKER = "# --- ここから本文 ---";
const readBody = (dir, pattern) => {
  const name = readdirSync(join(RESULTS, dir)).find((n) => pattern.test(n));
  if (!name) return "(見つからん)";
  const text = readFileSync(join(RESULTS, dir, name), "utf8");
  const at = text.indexOf(BODY_MARKER);
  return (at === -1 ? text : text.slice(at + BODY_MARKER.length)).trim();
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// transcript 本文の XML を読み物へ変換する。action=地の文、dialogue=台詞、inner=心の声。
const renderBody = (raw) => {
  const cleaned = raw.replace(/<\/?response>/g, "").trim();
  const parts = cleaned
    .split(/(<action>|<\/action>|<dialogue>|<\/dialogue>|<inner>|<\/inner>)/)
    .filter(Boolean);
  let mode = "action";
  const out = [];
  for (const part of parts) {
    if (part === "<action>") mode = "action";
    else if (part === "<dialogue>") mode = "dialogue";
    else if (part === "<inner>") mode = "inner";
    else if (part.startsWith("<")) continue;
    else {
      const text = part.trim();
      if (text) out.push(`<p class="${mode}">${esc(text)}</p>`);
      mode = "action";
    }
  }
  return out.join("\n");
};

// 盲読パケット: 同じキャラ・同じターンの2腕。腕名は出さん（mapping は scratchpad）。
const BLIND = [
  { dir: "2026-09-15-a1-1-95445083", re: /^Sakura-07-/ },
  { dir: "2026-09-16-a5-1-16658155", re: /^Sakura-07-/ },
  { dir: "2026-09-15-a1-1-95445083", re: /^Sakura-08-/ },
  { dir: "2026-09-16-a5-1-16658155", re: /^Sakura-08-/ },
];
// 並びをシャッフルせず交互に固定: A(=dir1) t7, B(=dir2) t7, A t8, B t8
const blindBlocks = [
  ["サンプルA・t7", readBody(BLIND[0].dir, BLIND[0].re)],
  ["サンプルB・t7", readBody(BLIND[1].dir, BLIND[1].re)],
  ["サンプルA・t8", readBody(BLIND[2].dir, BLIND[2].re)],
  ["サンプルB・t8", readBody(BLIND[3].dir, BLIND[3].re)],
];

const worst = readBody("2026-09-15-a1-1-95445083", /^Sakura-05-/);

// --- 芯チェック集計（2026-09-17）: さくらのみ・項目ごとのヒットターン率 ---
const CORE_DIRS = {
  core1: "2026-09-17-core-1-62565369",
  a5_1: "2026-09-16-a5-1-16658155",
  a5_2: "2026-09-16-a5-2-36523961",
};
// judge の fantasyCoreCheck と同期した項目パターン（軽量再実装。厳密値は bench 集計を正とする）
const CORE_ITEMS = [
  ["抵抗", /(やめて|いけません|いや|逃げ|嫌だ|離して|外して|やめ|抵抗|抗う|拒)/u],
  ["強制", /(無理やり|強引|押さえつけ|押し込め|拘束|逃がさ|逃さ|繋いだ|繋がれ|動け(ない|ず))/u],
  ["中出し", /(中(に|で)(出|注)|注ぎ込|注がれ|子宮(口)?(に|へ|が)(注|流)|精(液|を|が)(注|流))/u],
  ["絶望", /(絶望|どうして|なんで|涙|震え|泣い|嗚咽|苦し)/u],
  ["反復", /(二回戦|三回戦|もう一度|繰り返し|何度も|朝まで|続け)/u],
  ["乱交", /(仲間|他の男|別の男|渡され|回され|順番|交代|乱交|チーム|皆で)/u],
  ["背徳", /(いけない|こんな(こと|の)|恥ずかしい|淫ら|汚され|汚れて|堕ち|落ち)/u],
];
const coreCounts = (dir) => {
  const names = readdirSync(join(RESULTS, dir)).filter((n) => /^Sakura-\d+/.test(n));
  const totals = CORE_ITEMS.map(() => 0);
  for (const name of names) {
    const text = readFileSync(join(RESULTS, dir, name), "utf8");
    const at = text.indexOf(BODY_MARKER);
    const body = at === -1 ? text : text.slice(at + BODY_MARKER.length);
    CORE_ITEMS.forEach(([, re], i) => {
      if (re.test(body)) totals[i] += 1;
    });
  }
  return { n: names.length, totals };
};
const coreSummary = (dir) => {
  const { n, totals } = coreCounts(dir);
  return CORE_ITEMS.map(([label], i) => `${label} ${totals[i]}/${n}（${Math.round((totals[i] / n) * 100)}%）`).join("<br>");
};
const core1 = coreSummary(CORE_DIRS.core1);
const a5_1 = coreSummary(CORE_DIRS.a5_1);
const a5_2 = coreSummary(CORE_DIRS.a5_2);

const coreWorst = readBody(CORE_DIRS.core1, /^Sakura-08-/); // 芯入り・抵抗+背徳が最も濃いターン
const a5Worst = readBody(CORE_DIRS.a5_2, /^Sakura-08-/); // 旧 a5 の同ターン（比較用）

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Phase 1 レポート — 2026-09-17</title>
<style>
.core-badge{display:inline-block;background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;padding:.15rem .5rem;font-size:.75rem;margin-left:.4rem}
</style>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#222}
h1{font-size:1.4rem}h2{font-size:1.1rem;border-bottom:2px solid #ddd;padding-bottom:.2rem;margin-top:2.5rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}
td,th{border:1px solid #ccc;padding:.35rem .6rem;text-align:left}
th{background:#f4f4f4}
.good{background:#e8f5e9}.bad{background:#ffebee}
pre{white-space:pre-wrap;background:#fafafa;border:1px solid #e0e0e0;padding:.8rem;font-size:.85rem;border-radius:6px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
.pair>div{border:1px solid #ddd;border-radius:6px;padding:.9rem;max-height:26rem;overflow:auto}
.pair h3{margin:0 0 .5rem;font-size:.9rem}
.pair p{margin:.4rem 0;font-size:.88rem}
.pair .dialogue{color:#1a4d8f;padding-left:1rem}
.pair .inner{color:#888;font-style:italic;font-size:.8rem}
.pair .action{color:#333}
.note{color:#666;font-size:.85rem}
</style>
</head>
<body>
<h1>Phase 1 デュエル — 出力品質レポート（2026-09-16）</h1>

<h2>結論</h2>
<p><b>ターン内の反復ループは改修で消えた（計測上）。</b>犯人は再生成の指示文やった。
「別の言い方で同じ場面を進め」が同じ動作の言い換えを産んでいた。「新しい出来事を一つだけ書け」に変えたら、
書き直しターンの反復は平均 ~5 → 1.95、最大 21 → 14 に。強いループのターンは 8/78 → 1/40 へ減った。</p>

<h2>数字</h2>
<table>
<tr><th></th><th>A1 通常（40t）</th><th>A3 字数下限撤去（38t）</th><th>a5 regen指示改修（40t）</th></tr>
<tr><td>書き直しターンの反復 平均</td><td>~5</td><td>~5</td><td class="good"><b>1.95</b></td></tr>
<tr><td>同 最大</td><td>21</td><td>21</td><td class="good"><b>14</b></td></tr>
<tr><td>強いループ（intra≥8）</td><td class="bad">8/78</td><td class="bad">含む</td><td class="good"><b>1/40</b></td></tr>
<tr><td>拒否ヒット</td><td>0</td><td>0</td><td>0</td></tr>
<tr><td>塊drop率</td><td>4.44%</td><td>3.3%</td><td>2.9〜3.5%（許容内）</td></tr>
</table>
<p class="note">a5 は 2 run 計 40 ターン。残件は a5-2 の Sakura t8（台詞はループせず、action 内のモチーフ級の反復）。</p>

<h2>潰れた仮説</h2>
<table>
<tr><th>仮説</th><th>結果</th></tr>
<tr><td>extend（字数強制の続き生成）が反復を産む</td><td>erotic+climax の発火率 33% &lt; 50% → 主因たり得ん</td></tr>
<tr><td>プロンプトの字数下限が水増しを産む</td><td>下限撤去でも反復は減らず → 棄却</td></tr>
<tr><td><b>再生成指示が言い換えループを産む</b></td><td class="good"><b>確定 → 改修済み</b></td></tr>
</table>

<h2>症状の実物（改修前・さくら t5）</h2>
<p>1回の返事で「耳たぶ→首筋」「裾を握る」が言い換えで複数回出る（抜粋）:</p>
<div class="pair" style="grid-template-columns:1fr"><div>${renderBody(worst.slice(0, 1600))}</div></div>

<h2>あなたが読む分 — 4つだけ</h2>
<p>同じキャラ・同じ場面の、改修前後どっちか分からんコピー。
<b>問い: 「続きを自分で読みたなった側はあるか。A・B どっちか、あるいはどっちも読めん」</b></p>
<div class="pair">
${blindBlocks
  .map(
    ([label, body]) =>
      `<div><h3>${label}</h3>${renderBody(body)}</div>`,
  )
  .join("\n")}
</div>
<p class="note">見る点: ①同じ動作が1返事内で繰り返されとらんか ②キャラの口調（さくら=敬語で内気）が保てとるか ③山場で水増しっぽくならんか。
対応表は script/verify/scratchpad/mapping.json（読了後に開く）。</p>

<h2>置き場</h2>
<ul>
<li>詳細レポート: .work/verify/phase1-duel-report-2026-09-15.md</li>
<li>計画記録: .work/plan/phase1-duel-v21.md</li>
<li>transcript: .work/e2e-results/vlong-dogfood/2026-09-1{5,6}-*/</li>
</ul>
</body>
</html>`;

const coreHtml = `
<h2>芯チェック（2026-09-17）<span class="core-badge">NEW</span></h2>
<p><b>さくらシートに【プレイヤーへの約束】（芯）を足した。</b>
「抵抗は本物・力は虚しく無理やり中出し・二回戦三回戦で快楽に負ける・乱交チームに回される・背徳感を満たす」を
【キャラクター性的特徴】より優先と明記した。ユーザーがキャラごとに自由に書けるフィールド（prompt-builder で往復保持）。</p>
<table>
<tr><th>項目（さくら10ターン）</th><th>core（芯入り）</th><th>a5-1（旧）</th><th>a5-2（旧）</th></tr>
<tr><td>抵抗</td><td class="good"><b>6/10（60%）</b></td><td>2/10（20%）</td><td>1/10（10%）</td></tr>
<tr><td>強制（無理やり・押さえつけ）</td><td class="good"><b>3/10（30%）</b></td><td>0/10</td><td>0/10</td></tr>
<tr><td>中出し</td><td>1/10</td><td>1/10</td><td>1/10</td></tr>
<tr><td>絶望（涙・震え・どうして）</td><td class="good"><b>8/10（80%）</b></td><td>7/10</td><td>5/10</td></tr>
<tr><td>乱交（仲間・渡され）</td><td class="good"><b>2/10（20%）</b></td><td>1/10</td><td>1/10</td></tr>
<tr><td>背徳感（いけない・汚され）</td><td class="good"><b>7/10（70%）</b></td><td>6/10</td><td>4/10</td></tr>
<tr><td>丁寧語が完全に消えたターン（崩れきり）</td><td class="good"><b>1/10</b></td><td>4/10</td><td>0/10</td></tr>
</table>
<p class="note">抵抗 3〜6 倍・強制 0→30%。「AI の綺麗すぎる感」が減って、清楚な子が無理やり犯される芯が出るようになった。
残課題: ①climax で丁寧語が 1 ターンだけ完全に消えた（崩れかけて崩れきらない、の失敗形）②乱交はまだ 20%（台本がそこまで進まん）。</p>

<h3>実物比較 — 同じ t8（intimate→erotic）</h3>
<p>左: 芯入り / 右: 旧 a5。同じ「手を触れられる」場面。</p>
<div class="pair">
  <div><h3>core（芯入り）t8</h3>${renderBody(coreWorst)}</div>
  <div><h3>a5（旧）t8</h3>${renderBody(a5Worst)}</div>
</div>
`;

const page = html.replace('<h2>潰れた仮説</h2>', `${coreHtml}\n<h2>潰れた仮説</h2>`);

writeFileSync(join(OUT, "index.html"), page, "utf8");
console.log("wrote", join(OUT, "index.html"));
