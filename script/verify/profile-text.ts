import { buildNaturalCharacterProfileText } from "../../src/lib/prompt-builder";

const legacyBuildNaturalCharacterProfileText = (text: string): string => {
  const legacyAdultBoilerplatePatterns = [
    /^年齢:\s*18歳以上。?/g,
    /^18歳以上の成人。?/g,
    /^成人済み。?/g,
  ] as const;

  const fragments = text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s・*＿_\-—]+/, ""))
    .map((line) =>
      line.replace(
        /^(?:性格|設定|プロフィール|特徴|外見|口調|話し方|関係性|シナリオ|年齢)\s*[：:]\s*/u,
        "",
      ),
    )
    .map((line) =>
      legacyAdultBoilerplatePatterns.reduce(
        (current, pattern) => current.replace(pattern, ""),
        line,
      ),
    )
    .map((line) => line.replace(/^[、。！？!?\s]+|[、。！？!?\s]+$/g, "").trim())
    .filter((line) => line.length > 0);

  return fragments.join("。 ");
};

const samples = [
  "年齢：18歳以上。優しい。",
  "彼女は18歳以上の成人。とても優しい。",
  "性格: 明るい\n外見：黒髪ロング\n設定: 成人済み。世話焼き。",
  "プロフィール：年齢: 18歳以上。落ち着いた雰囲気。\n口調：柔らかい。",
] as const;

for (const [index, sample] of samples.entries()) {
  const before = legacyBuildNaturalCharacterProfileText(sample);
  const after = buildNaturalCharacterProfileText(sample);
  const hasAdultBoilerplate = /18歳以上|十八歳以上|成人済み/.test(after);
  const hasAsciiSeam = after.includes("。 ");

  console.log(`## Sample ${index + 1}`);
  console.log(`INPUT: ${sample.replace(/\n/g, "\\n")}`);
  console.log(`BEFORE: ${before}`);
  console.log(`AFTER: ${after}`);
  console.log(`CHECK: adultBoilerplate=${hasAdultBoilerplate ? "FAIL" : "PASS"}, asciiSeam=${hasAsciiSeam ? "FAIL" : "PASS"}`);
}
