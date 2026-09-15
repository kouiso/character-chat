import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const rows = fs
  .readFileSync(path.join(DIR, "raw-runs.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5));
  return s[i];
};

const names = {
  1: "cell1 long+ambiguous(re-ask)",
  2: "cell2 long+unambiguous",
  3: "cell3 short control",
};

for (const cell of [1, 2, 3]) {
  const r = rows.filter((x) => x.cell === cell);
  const ok = r.filter((x) => x.error === null && x.ttfcMs !== null);
  const first = ok.map((x) => x.ttfcMs);
  const eff = ok.map((x) => x.ttfcAfterLastRegenMs ?? x.ttfcMs);
  console.log(
    JSON.stringify(
      {
        cell: names[cell],
        n: r.length,
        ok: ok.length,
        errors: r.filter((x) => x.error !== null).map((x) => x.error?.slice(0, 40)),
        ttfc_first_min: q(first, 0),
        ttfc_first_p50: q(first, 0.5),
        ttfc_first_max: q(first, 1),
        over10s_first: first.filter((v) => v > 10000).length,
        ttfc_effective_min: q(eff, 0),
        ttfc_effective_p50: q(eff, 0.5),
        ttfc_effective_max: q(eff, 1),
        over10s_effective: eff.filter((v) => v > 10000).length,
        hedgeFired: ok.filter((x) => x.hedgeFired).length,
        reaskFired: r.filter((x) => x.reaskFired).length,
        reaskLatencyP50: q(
          r.filter((x) => x.reaskLatencyMs != null).map((x) => x.reaskLatencyMs),
          0.5,
        ),
        reaskLatencyMax: q(
          r.filter((x) => x.reaskLatencyMs != null).map((x) => x.reaskLatencyMs),
          1,
        ),
        regenZero: ok.filter((x) => x.regenerating === 0).length,
        regenHist: ok.reduce((m, x) => {
          m[x.regenerating] = (m[x.regenerating] ?? 0) + 1;
          return m;
        }, {}),
      },
      null,
      1,
    ),
  );
}

// 再生成0本だけに絞った数字（作り直し経路を混ぜない比較用）
console.log("--- regeneration==0 subset ---");
for (const cell of [1, 2, 3]) {
  const ok = rows.filter(
    (x) => x.cell === cell && x.error === null && x.ttfcMs !== null && x.regenerating === 0,
  );
  const v = ok.map((x) => x.ttfcMs);
  console.log(
    JSON.stringify({
      cell: names[cell],
      n: v.length,
      min: q(v, 0),
      p50: q(v, 0.5),
      max: q(v, 1),
      over10s: v.filter((x) => x > 10000).length,
      hedgeFired: ok.filter((x) => x.hedgeFired).length,
    }),
  );
}
