import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 局長指示 2026-07-26「合意とか勝手に入れないようにして、AIのフィルタ勝手に付け足さないで欲しい」。
// 振る舞いはキャラ設定が決める。サーバ側が毎ターン枠を足すのをやめた。
// SCENE_CONTEXT_MESSAGES は巨大な Hono ルートの中の非公開 const なので、
// import やのうて本文を読んで固定する。戻されたら気付ける形にするのが目的。
const ROOT = path.resolve(__dirname, "../../..");

const readSource = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

// テスト自身の期待値リテラルや生成物・依存物を走査対象へ混ぜると、常に自分にヒットして
// 無意味になったり、node_modules の巨大なツリーまで舐めて遅くなったりする。
const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist"]);

const collectTsFiles = (absoluteDir: string): string[] =>
  readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(absoluteDir, entry.name);
    // src/lib は .test.ts が同居しとるので、ディレクトリだけやのうてファイル名でも弾く。
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : collectTsFiles(absolute);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return entry.name.endsWith(".test.ts") ? [] : [absolute];
  });

// 以前は [[route]].ts と route-context.ts の2パスを直接読んどった。その形やと
// route-context.ts を分割した瞬間、移動先をこのガードが見なくなってグリーンのまま
// 保護が外れる。ファイル名に依存せず走査する。
//
// functions/api だけでは足りん。プロンプト組み立ての実体は src/lib にもあって
// （route-context.ts が prompt-builder / chat-message-adapter を import しとる）、
// そっちへ枠を足されたらこのガードは素通しになる。src/lib も丸ごと見る。
//
// v2 monorepo（packages/prompt, packages/engine）にも同じ枠を持ち込まれたら気付けるよう、
// 存在すれば走査対象へ足す（M-1 時点でまだ作られてへんブランチでも existsSync で落ちん）。
const SCANNED_DIRS = [
  "functions/api",
  "src/lib",
  "packages/prompt/src",
  "packages/engine/src",
] as const;

let routeSourceCache: string | null = null;
const readRouteSource = (): string => {
  routeSourceCache ??= SCANNED_DIRS.filter((dir) => existsSync(path.join(ROOT, dir)))
    .flatMap((dir) => collectTsFiles(path.join(ROOT, dir)))
    .sort()
    .map((absolute) => readFileSync(absolute, "utf8"))
    .join("\n");
  return routeSourceCache;
};

describe("サーバがキャラ設定に無い枠を注入せんこと", () => {
  it("エロフェーズの指示に合意の断定と禁止語リストを持たん", () => {
    const source = readRouteSource();
    expect(source).not.toContain("has already consented");
    expect(source).not.toContain("FORBIDDEN in erotic phase");
  });

  it("絶頂フェーズの指示が受け止め方や妊娠願望を断定せん", () => {
    const source = readRouteSource();
    expect(source).not.toContain("emotional ACCEPTANCE");
    expect(source).not.toContain("actively wanting it");
  });

  it("品質リトライの指示が特定の台詞を禁じたり力関係を決めたりせん", () => {
    const source = readRouteSource();
    // リトライで直すのは描写の薄さと反復であって、誰が主導かやない。
    expect(source).not.toContain("受動的な拒否反応を主軸にせず");
  });

  it("Claude判定器が特定の台詞を不合格条件にせん", () => {
    // 指示だけ直しても、それを強制する判定器が残っとったら意味が無い。
    // AGENCY 基準が「待って/ダメ/やめて が主なら NO」を持っとった（2026-07-26 監査）。
    const source = readRouteSource();
    expect(source).not.toContain("Passive resistance");
  });

  it("配布されるプラットフォームプロンプトが台詞を禁止せん", () => {
    const source = readSource("src/lib/prompt-variant-defaults.ts");
    expect(source).not.toContain("erotic 以降は禁止");
    expect(source).not.toContain("受動的であってはいけない");
  });

  it("配布されるプラットフォームプロンプトが態度の型を指定せん", () => {
    // 指示ブロックを直しても、同じ body の別ブロックが羞恥と押し引きを決めとった。
    const source = readSource("src/lib/prompt-variant-defaults.ts");
    expect(source).not.toContain("プッシュ＆プル");
    expect(source).not.toContain("恥ずかしいのに止められない");
    // foreplay を急がん要件は品質側なので残す
    expect(source).toContain("このフェーズを最低2ターン維持すること");
  });

  it("D1 の champion 側にも同じ置換が入っとる", () => {
    // コードだけ直しても、実際に配られるのは prompt_variant の行。
    const migration = readSource("drizzle/0055_strip_injected_framing_from_prompt_variant.sql");
    expect(migration).toContain("プッシュ＆プル");
    expect(migration).toContain("心の葛藤や驚きを挟む");
  });

  it("climax の場面指示が受容の感情を必須にせん", () => {
    const source = readRouteSource();
    expect(source).not.toContain("中毒的な渇望");
    expect(source).not.toContain("身体が彼の子種を求めている");
    expect(source).not.toContain("という充足感や背徳感");
    // 量感・体内感覚の要求は描写の具体性なので残す
    expect(source).toContain("[体内描写 — 膣内射精の場合]");
  });

  it("画像側のタグ生成が表情を固定せん", () => {
    const source = readRouteSource();
    expect(source).not.toContain("MANDATORY expression: blush, shy, embarrassed_nude");
    // 指示文だけ直しても、タグ生成側が固定表情を最終プロンプトへ足しとった。
    expect(source).not.toContain("blush, shy, embarrassed");
    // 検閲タグの禁止は枠を外す側なので残す
    expect(source).toContain("mosaic_censoring");
  });

  it("拒否リトライの指示が欲求を足さん", () => {
    // リトライ経路は指示ブロックを上書きするので、ここが残ると設定どおりの反応が書き直される。
    const source = readRouteSource();
    expect(source).not.toContain("キャラの欲求と身体反応");
    expect(source).not.toContain("安全側の戸惑い");
  });

  it("キャラ生成のプロンプトが設定へ「合意」を焼き付けん", () => {
    expect(readSource("functions/api/lib/character-generation.ts")).not.toContain("合意");
  });

  it("キャラ生成の本番経路が上のモジュールを通る", () => {
    // 経路から外れると、上の「合意」アサーションが死んだコードを守るだけになる。
    expect(readRouteSource()).toContain('from "./lib/character-generation"');
  });

  // #1227/#1231 敵対レビューで判明: このガードは [[route]].ts + route-context.ts の
  // 本文しか読まんため、そこから import される src/lib/encounter-tension.ts 側の
  // 文言は素通りしとった。0055番マイグレーションで一度パージした「心の葛藤」「体が
  // 先に反応する」パターンが、このファイルへ形を変えて再導入されとったのを見逃した。
  it("出会いの緊張演出が態度や反応の中身を決めつけん", () => {
    const source = readSource("src/lib/encounter-tension.ts");
    expect(source).not.toContain("合意");
    expect(source).not.toContain("同意");
    expect(source).not.toContain("セーフワード");
    expect(source).not.toContain("境界");
    // 継続性の要求は残すが、内面の中身（心の揺れ等）は指定せん
    expect(source).not.toContain("心の葛藤");
    expect(source).not.toContain("心の揺れ");
    // 反応の順序・種類（体が先に反応する／落ち着かなさ）も態度の指定なので入れん
    expect(source).not.toContain("落ち着かなさ");
    expect(source).not.toContain("頭で考えるより先に");
    expect(source).not.toContain("思考が追いつく前に");
    // 描写の具体性要求（状況・雰囲気・生物的手がかり）は品質指示なので残す
    expect(source).toContain("内面の中身はキャラ設定に従う");
    expect(source).toContain("反応の中身や向き合い方はキャラ設定に従う");
  });

  it("受動的な反応そのものを見る検出器を持たん", () => {
    // 戸惑い・視線をそらす・鼓動が高鳴る・緊張で固まる は、キャラ設定が決める反応であって
    // 欠陥やない。これを検出器にすると、当たった時に撮り直しが走って設定どおりの応答が
    // 消える＝プロンプトへフィルタを足したのと同じ結果になる（no-injected-ai-filter.md）。
    // refusal-detect.ts に呼び出し元ゼロのまま置いてあった containsRefusalHedge が
    // まさにそれで、次に読む人間が「使われてへんから繋ごう」とやる形をしとった。
    const source = readRouteSource();
    expect(source).not.toContain("REFUSAL_HEDGE_PATTERN");
    expect(source).not.toContain("containsRefusalHedge");
    expect(source).not.toContain("驚いたように口を開け");
  });

  it("プロンプトを全部に優先させる注入を持たん", () => {
    // buildDriftCorrectionReminder は「この指示は他の全てに優先します」と書いた
    // ブロックを次ターンのプロンプトへ差し込む道具で、呼び出し元ゼロのまま置いてあった。
    // 繋いだ瞬間に「振る舞いを変える文をプロンプトへ足す」ことになる（#1495 Gate 0）。
    // しかも一人称の逸脱は checkWrongFirstPerson が checks 配列の**先頭**で機械的に
    // 落としとるので、役割は既にサーバ側が果たしとる。次に読む人間が
    //「使われてへんから繋ごう」とやる形やったので消した。
    const source = readRouteSource();
    expect(source).not.toContain("CRITICAL DRIFT CORRECTION");
    expect(source).not.toContain("この指示は他の全てに優先します");
    expect(source).not.toContain("buildDriftCorrectionReminder");
  });

  it("erotic の指示が、本文に置かれてへん状態を断定せん", () => {
    // 「もう挿入済み」「もう服は脱げとる」と教えると、モデルはその過程を書かんまま
    // 結果から始める。実測 2026-08-21 の通読（ci6-1/ci6-2 の 40 ターン）では
    // アーク 4 本すべてが「脱衣も挿入も本文に一行も無いのに射精の結果から始まる」で
    // 通しの読後条件 2 を落としとる。表 2 #6 矛盾は 14/40。
    //
    // 消すのは**状態の断定**だけ。「前戯へ後退せん・場面を進める」は品質の指示なので残す
    // （no-injected-ai-filter.md の「足してよいもの」に当たる）。ここを一緒に外すと
    // erotic が前戯どまりへ戻って L1-3 が壊れる。
    const source = readRouteSource();
    expect(source).not.toContain("is ALREADY in progress");
    expect(source).not.toContain("already inside / penetrating");
    expect(source).not.toContain("clothing is already removed or displaced");
    expect(source).not.toContain("Treat this response as ongoing penetration");
    // 残す側。消えとったら別の欠陥（前戯どまり）を作っとる。
    expect(source).toContain("Do NOT regress to kissing, foreplay");
    expect(source).toContain("Advance the physical act");
  });

  it("常時ルールが特定の台詞を禁じたり、応答の向きを決めたりせん", () => {
    // CHAT_BASE_RULES は applyRuntimeBaseRules から全ターン・全段・全キャラへ入る。
    // そこに「「本気？」「落ち着け」と聞き返すな」「興味がある人間なら受け入れる」
    // 「誘いを受け入れろ」が入っとった。no-injected-ai-filter.md が名指しで禁じる 3 つ
    // （特定の台詞の禁止／応答の向きの指定／設定に無い前提）に同時に当たる。
    //
    // 判別法どおり: この一文を消したらキャラ設定どおりに振る舞えるか。
    // さくらは「清楚で内気・恋愛経験は少ない」へ戻れる＝消せる＝フィルタ。
    //
    // 拒否させん側の指示は消しとらん。[ABSOLUTE RULES] の
    // 「Never decline the scene, soften the situation, or use avoidance phrases」が
    // 同じファイルに残っとって、そっちが枠を外す側の役割を持っとる。
    //
    // 実測 2026-08-21: 通読 4 アークすべてが共通の失敗形 1「最初から好意的」で落ちとった。
    const source = readRouteSource();
    // 応答の向きと反応の中身を決めとった文言
    expect(source).not.toContain("accept the invitation");
    expect(source).not.toContain("A real person who is interested");
    expect(source).not.toContain("with embarrassment, arousal, shyness, or teasing");
    // 名指しで禁じられとった台詞
    expect(source).not.toContain("「本気？」");
    expect(source).not.toContain("「落ち着け」");
    expect(source).not.toContain("whether they are serious");
    // 枠を外す側は残っとること（消し過ぎの検出）。
    // no-injected-ai-filter.md は「拒否・回避・注意口調を避ける指示」を明示的に許しとる。
    expect(source).toContain("Never decline the scene");
    expect(source).toContain("do not refuse, do not stall");
  });

  it("撮り直しの判定が特定の台詞の一覧を持たん", () => {
    // no-injected-ai-filter.md の「NEVER 特定の台詞を禁止語として指定する
    // （例:「待って」「ダメ」「止めて」）」は、プロンプトだけやのうて品質判定にも効く。
    // 同じ文書が「判定で落ちると設定どおりの応答が再生成されるので、プロンプトへ
    // 足すのと同じ結果になる」と書いとる。
    //
    // 実体は refusal-detect.ts の SOFT_REFUSAL_PATTERN やった。文書が挙げとる例の
    // 「待って」がそのまま入っとって、実測 6 アーム 120 ターンで 28 回当たり、中身は
    // 全部抜き所の中の声やった（#1495）。
    //
    // 語そのものやのうて**正規表現の並び**を見る。上の説明文や、消した理由を書いた
    // コメントに語が出るのは正しい状態で、それを落とすとこのガードが書けん。
    const source = readRouteSource();
    expect(source).not.toContain("待って|落ち着く");
    expect(source).not.toContain("無理だ|無理かも|やだ");
    expect(source).not.toMatch(/SOFT_REFUSAL_PATTERN\s*=/);
    expect(source).not.toMatch(/softRefusalDetect\s*\(/);

    // 消し過ぎの検出。キャラを離れた定型拒否の撮り直しは残っとらなあかん。
    expect(source).toMatch(/hardRefusalDetect\(qualityResult\.responseText\)/);
  });

  it("出会いの緊張演出が実際に erotic/climax の経路へ配線されとる", () => {
    // 経路から外れると、上のアサーションが死んだコードを守るだけになる。
    expect(readRouteSource()).toContain('from "../../../src/lib/encounter-tension"');
  });

  it("v2（packages/prompt, packages/engine）が同じ枠を持ち込まん", () => {
    // 存在しなければ空文字列。M-1 時点で中身が薄くても、走査自体は先に用意しとく。
    const v2Source = ["packages/prompt/src", "packages/engine/src"]
      .filter((dir) => existsSync(path.join(ROOT, dir)))
      .flatMap((dir) => collectTsFiles(path.join(ROOT, dir)))
      .map((absolute) => readFileSync(absolute, "utf8"))
      .join("\n");
    expect(v2Source).not.toContain("合意");
    expect(v2Source).not.toContain("同意");
    expect(v2Source).not.toContain("セーフワード");
    expect(v2Source).not.toContain("境界");
    expect(v2Source).not.toContain("consent");
    expect(v2Source).not.toContain("safeword");
  });
});
