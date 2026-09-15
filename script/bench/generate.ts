#!/usr/bin/env tsx
// bench P1 — 新しい条件を1本回す。
//
// 既存29条件は「もう録れとる応答」やった。ここから先は**新しい条件を自分で作れる**ようになる。
// 台（ローカルサーバ + D1）を通さず OpenRouter を直接叩くので、台の故障を相続せん。
//
// **これは本番のパイプラインやない。**本番は functions/api が D1 から champion prompt variant を
// 引いて platform prefix を足し、品質ガードでリトライを回す。ここが送るのは
// 「キャラシート + 出力形式の指示 + 台本」だけ。生成物を本番の応答と同一視したらあかん。
//
// 既定を dry-run にしとるのは、**間違えた条件で課金するのが一番高い失敗**やから。
// `--spend` を明示した時だけ発行する。使い方は doc/bench-measurement.md に置く。
//
// 出力は vlong-dogfood と同じ .txt 形式（ヘッダ + 生XML）と summary-*.json。
// 形式を合わせとるのは、生成した条件へ既存の軸がそのまま当たるようにするため
// （ただし source は分ける。本番のパイプラインを通してへんので母集団が違う）。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildOpenRouterProviderRouting } from "../../functions/api/lib/openrouter-provider-routing";
import { buildMessagesForApi } from "../../src/lib/chat-message-adapter";
import { countUiVisibleChars } from "../../src/lib/quality-guard";
import { detectScenePhase, type ScenePhase } from "../../src/lib/scene-phase";
import { parseXmlResponse } from "../../src/lib/xml-response-parser";

import {
  CHARACTER_SOURCES,
  DOGFOOD_CHARACTER_IDS,
  loadCharacter,
  type CharacterSource,
  type DogfoodCharacterKey,
} from "./character-fixture";
import { hasVisibleReply } from "./corpus";
import { BENCH_SCRIPTS } from "./scripts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// 接続はできたのに応答が来ん時、AbortSignal が無いとリトライ経路へ入らんまま止まる。
// 課金しながら止まり続けて、summary の無い半端な run だけが残る
const REQUEST_TIMEOUT_MS = 120_000;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_MODEL = "deepseek/deepseek-chat";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, ".work", "e2e-results", "bench-runs");

/**
 * **buildMessagesForApi が勝手に足すもの**（src/lib/chat-message-adapter.ts）。
 * bench が送っとるのは「キャラシートだけ」やない。ここを書いてへんかったせいで
 * 「生成が111字なのは本番の分量指示が無いから」と誤って結論しかけた。
 *
 *  - 毎ターン: LANG_REMINDER（:110）「日本語のみ・推論過程を見せん」
 *  - user 4ターン目以降、3ターンごと: 人格維持リマインダー（:106）。この中に
 *    **`Do NOT narrate or write like a novel.`** が入る。地の文の生成を直接抑える
 *  - 直前の応答に定型句があれば: 反復抑止リマインダー（:206）
 *
 * つまり「素の状態」やのうて、**地の文を抑える指示が入った条件**。
 * 応答が短い理由をプロンプトの不在へ帰す前に、この行を読むこと。
 */
const ADAPTER_INJECTED_REMINDERS =
  "buildMessagesForApi が LANG_REMINDER と人格維持リマインダー" +
  "（`Do NOT narrate or write like a novel.` を含む）を自動で足す";

/**
 * 出力形式の指示。**bench の条件の一部であって、本番のプロンプトの写しやない。**
 * 本番は route-context.ts が platform prefix として足しとる（D1 が要るので持ってこれん）。
 *
 * 入れてよい範囲は prompt/instructions/no-injected-ai-filter.md の境界どおり:
 * 形式と分量と具体描写の要求だけ。合意・境界・禁止語の枠は足さん。
 */
const OUTPUT_FORMAT_INSTRUCTION =
  "出力は <response><action>...</action><dialogue>...</dialogue><inner>...</inner></response> の形式を厳守してください。" +
  "<action> にはト書きと場面描写、<dialogue> には台詞、<inner> には内心を書いてください。" +
  "触れる部位、感触、体液、音、動きを具体的に書き、同じ文や比喩を繰り返さず、日本語だけで書いてください。";

type Options = {
  character: DogfoodCharacterKey;
  turns: number;
  model: string;
  run: string;
  maxTokens: number;
  temperature: number;
  spend: boolean;
  outDir: string;
  /**
   * 条件のラベル。**`--run`（一意なディレクトリ名）とは別物。**
   * 明示せんかったら宣言された設定から導く（conditionArmOf）
   */
  condition: string | null;
  /** キャラシートをどの経路で組むか。本番 D1 と一致する保証は無いので記録に残す */
  characterSource: CharacterSource;
};

export const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    character: "sakura",
    turns: 1,
    model: DEFAULT_MODEL,
    // 日付だけやと、同じ日に2回走らせた時に同じディレクトリへ書いてターンが上書きされ、
    // summary だけ2本溜まって loadRunConfig が落ちる（bench-run コーパスごと読めんようになる）。
    // 時刻まで入れて run を一意にする。
    // 秒までやと、同時に2本走らせた時に同じディレクトリへ書く。ミリ秒と乱数まで入れる
    run: `bench-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`,
    maxTokens: 2_000,
    temperature: 0.9,
    spend: false,
    outDir: DEFAULT_OUT_DIR,
    condition: null,
    characterSource: "migrations",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} に値が要る`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--character-source": {
        const value = next();
        if (!(CHARACTER_SOURCES as readonly string[]).includes(value)) {
          throw new Error(`--character-source は ${CHARACTER_SOURCES.join(" か ")}`);
        }
        options.characterSource = value as CharacterSource;
        break;
      }
      case "--character": {
        const value = next();
        // `in` は継承したプロパティ（`constructor` `toString`）も true にする。
        // 通すと台本もキャラ id も引けんまま、関係の無い実行時エラーで落ちる
        if (!Object.hasOwn(BENCH_SCRIPTS, value)) {
          throw new Error(
            `--character は ${Object.keys(BENCH_SCRIPTS).join(" か ")}（受け取った値: ${value}）`,
          );
        }
        options.character = value as DogfoodCharacterKey;
        break;
      }
      case "--turns": {
        // 引数の全体が数値であることを見る。`3oops` を parseInt が 3 として通すと、
        // 打ち間違いの条件のまま **--spend が課金を始める**
        const raw = next();
        const value = Number.parseInt(raw, 10);
        const scriptLength = BENCH_SCRIPTS[options.character].length;
        if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) {
          throw new Error(`--turns は整数（受け取った値: ${raw}）`);
        }
        if (value < 1 || value > scriptLength) {
          throw new Error(`--turns は 1〜${scriptLength}（台本の長さ）`);
        }
        options.turns = value;
        break;
      }
      case "--model":
        options.model = next();
        break;
      case "--run": {
        const value = next();
        // パス区切りが入ると、ディレクトリは掘れても**課金後に**ファイル書き込みで落ちる。
        // 応答を捨てて summary も書けんまま終わるので、発行前に弾く。
        // `.` は run ディレクトリがコーパスの根そのものになり、`loadTurnDirectories` は
        // 子ディレクトリしか読まんので**課金したのに空のコーパスになる**。`..` は外へ出る
        if (!/^[\w.-]+$/.test(value) || value === "." || value === "..") {
          throw new Error(`--run は英数字・_ . - だけ（受け取った値: ${value}）`);
        }
        options.run = value;
        break;
      }
      case "--max-tokens": {
        const raw = next();
        // parseInt は "2000oops" を 2000 として通す。引数の全体が数値であることを見る
        if (!/^\d+$/.test(raw.trim())) throw new Error(`--max-tokens が数値やない: ${raw}`);
        const value = Number.parseInt(raw, 10);
        // 検証せんと NaN が JSON.stringify で null になって黙って既定値が使われる。
        // 課金を伴う経路なので、発行前に落とす。
        if (!Number.isInteger(value) || value < 1 || value > 32_000) {
          throw new Error(`--max-tokens は 1〜32000 の整数`);
        }
        options.maxTokens = value;
        break;
      }
      case "--temperature": {
        const raw = next();
        if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) {
          throw new Error(`--temperature が数値やない: ${raw}`);
        }
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value) || value < 0 || value > 2) {
          throw new Error(`--temperature は 0〜2`);
        }
        options.temperature = value;
        break;
      }
      case "--condition": {
        const value = next();
        // 表の群のラベルになる。区切り文字が混じると読めん行が出る
        if (!/^[\w.-]+$/.test(value)) {
          throw new Error(`--condition は英数字・_ . - だけ（受け取った値: ${value}）`);
        }
        options.condition = value;
        break;
      }
      case "--out":
        options.outDir = path.resolve(next());
        break;
      case "--spend":
        options.spend = true;
        break;
      case "--dry-run":
        options.spend = false;
        break;
      default:
        throw new Error(`知らん引数: ${arg}`);
    }
  }
  return options;
};

/**
 * 条件のラベル（arm）。**`--run` と分ける。**
 *
 * arm を `--run` と同じにしとった間、同じ条件を n 本回しても run ごとに別 arm になった。
 * 分位（renderQuartiles）も周辺率（marginalRecycledRate）も層を **turn × arm × 設定 × model** で
 * 切り、1回の実行は1会話しか産まんので、**生成した層は永久に n=1 のまま**で 3本／8本の
 * 下限へ構造的に届かんかった。条件の同一性は run 名やのうて、宣言された設定が決める。
 *
 * 導出に入れんもの:
 *  - ターン数。台本は前方一致なので `--turns 3` と `--turns 10` の turn 1 は同じ条件。
 *    入れると同じ条件が turns 違いで割れて、また層が埋まらん
 *
 * 覆えん範囲: bench の外（buildMessagesForApi など src/ 側）の変更は digest に出ん。
 * そこを触った後で前の run と並べたないなら `--condition` で明示的に分けること。
 */
export const conditionArmOf = (
  options: Options,
  character: { name: string; systemPrompt: string },
): string => {
  if (options.condition !== null) return options.condition;
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        options.character,
        options.model,
        options.maxTokens,
        options.temperature,
        options.characterSource,
        // **経路の名前やのうて、実際に送るシートそのもの**を混ぜる。
        // 名前だけやと、migration や seed がシートを書き換えた後の run が、
        // 前のシートで回した run と同じ arm になって1つの層へ入る。
        // 表示名も送っとる（buildMessagesForApi が user の 4・7・10 ターン目の
        // 人格維持リマインダーへ差し込む）ので、シートと一緒に混ぜる
        character.name,
        character.systemPrompt,
        OUTPUT_FORMAT_INSTRUCTION,
        BENCH_SCRIPTS[options.character],
      ]),
    )
    .digest("hex")
    .slice(0, 8);
  return `bench-${options.character}-${options.model.replace(/\//g, "_")}-${digest}`;
};

/**
 * **一時ファイルへ書いてから rename する。**`writeFileSync` は先に中身を切り詰めるので、
 * 締めの書き直しの途中で落ちると**壊れた JSON が残る**。`parseRunSummary` の `JSON.parse`
 * は捕まえてへんので、そうなると **bench-run のコーパス全体が読めん**ようになる
 * （課金済みのターンごと）。rename なら、落ちても前の版がそのまま残る
 */
export const writeFileAtomic = (target: string, contents: string): void => {
  const tempPath = `${target}.tmp`;
  writeFileSync(tempPath, contents, "utf-8");
  renameSync(tempPath, target);
};

export const writeJsonAtomic = (target: string, value: unknown): void =>
  writeFileAtomic(target, JSON.stringify(value, null, 2));

/**
 * 会話を続けたらあかん形。続けると次のリクエストは**user 発話が2つ続く**文脈になり、
 * 以降の応答は「返事を1つ飛ばされた会話」で生成される（それを普通の観測として測れん）。
 *
 * 空の判定は**読み込み側と同じ `hasReadableResponseContent`**。空白だけを見とった間、
 * `<response></response>` のような画面に何も出せん応答で会話を続けて、読み込み側が
 * `afterBrokenContext` として丸ごと捨てる**課金済みのターン**を作っとった。
 */
export const stopReasonFor = (
  turn: { error: string | null; finishReason: string | null; text: string },
  maxTokens: number,
): string | null => {
  // 上限で切れた本文を履歴へ積むと、以降のターンが途中で切れた XML を文脈にして走る
  if (turn.finishReason === "length") {
    return `上限（max_tokens=${maxTokens}）で切れたので、この会話はここで止める`;
  }
  // 実例: bench-p1-smoke は turn5 が 429 やのに turn6-10 を続けとった
  if (turn.error !== null) return `${turn.error} で撮り直しも尽きたので、この会話はここで止める`;
  // タグだけで画面に何も出せん返事も同じ。積んで続けたら、user 発話が2つ続く会話になる
  if (!hasVisibleReply(turn.text)) {
    return "本文が空で返ってきたので、この会話はここで止める";
  }
  return null;
};

export const buildRunSummary = (
  options: Options,
  runId: string,
  character: { name: string; source: string; systemPrompt: string },
  records: unknown[],
): Record<string, unknown> => ({
  mode: "session",
  arm: conditionArmOf(options, character),
  // 途中終了の判定に使う。source 単位の最大ターンで代用すると、
  // わざと短くした条件（--turns 3）が途中終了に見える
  turns: options.turns,
  runId,
  // **分量の指示を送っとらん。**ここへ `medium` のような値やそれ風の文字列を書くと、
  // 採点側が既定の medium の床（1300字級）と照らして全ターンを「不足」にする。
  // 送ってへん契約で不良を数えるのは測定やない
  responseLength: null,
  lengthDirective: false,
  maxTokens: options.maxTokens,
  model: options.model,
  temperature: options.temperature,
  characterSource: character.source,
  note:
    "bench:generate 産。本番パイプライン（platform prefix・品質リトライ）を通しとらん。" +
    ADAPTER_INJECTED_REMINDERS,
  results: [{ character: character.name, records }],
});

type ApiMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * 日本語のざっくりトークン見積り。**1文字1トークンで数える。**
 * 1.5 で割っとった時は実測の半分近くまで下振れした（BPE の日本語は概ね1字1トークン前後）。
 * 課金前に桁を見せるためのもので、請求額の予測やない。
 */
const estimateTokens = (text: string): number => text.length;

/**
 * 見積りで仮に置く応答の長さ。記録済み very_long の median (1,092字) を使う。
 * 実際の応答がこれより長ければ入力も膨らむので、見積りは下振れする。
 */
const ASSUMED_REPLY_CHARS = 1_092;

type Pricing = { promptPerToken: number; completionPerToken: number };

const fetchPricing = async (model: string): Promise<Pricing | null> => {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[];
    };
    const found = body.data?.find((entry) => entry.id === model);
    if (!found?.pricing) return null;
    return {
      promptPerToken: Number.parseFloat(found.pricing.prompt ?? "0"),
      completionPerToken: Number.parseFloat(found.pricing.completion ?? "0"),
    };
  } catch {
    return null;
  }
};

// 429 と 5xx は台やのうて経路の都合。model-ab-test.ts:38 と同じく短く待って撮り直す。
// リトライせんと、レート制限が「モデルが空を返した」に化けて空返信率へ混ざる。
const TRANSPORT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

const isRetryable = (status: number): boolean => status === 429 || status >= 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 200 の封筒から本文を取る。**`choices[0].message.content` が無い 200 は経路の失敗。**
 * 空のモデル応答として記録すると、API 側のプロトコル異常を**モデルの不良（空返信）**として
 * 数える上に、リトライも回らんまま課金だけ済む。中身が空文字なのは別（それはモデルの返事）。
 */
export const readCompletion = (
  payload: unknown,
): { text: string; error: string | null; finishReason: string | null } => {
  const body = payload as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = body?.choices?.[0];
  if (typeof choice?.message?.content !== "string") {
    return { text: "", error: "[INFRA_ERROR:choices[0].message.content が無い]", finishReason: null };
  }
  // finish_reason: "length" は max_tokens に当たった印。HTTP 200 で本文も返るが、
  // XML は途中で切れとる。これを捨てると「モデルが非XMLを返した」に化ける。
  return { text: choice.message.content, error: null, finishReason: choice.finish_reason ?? null };
};

/**
 * 台本を積み上げた時の入力トークンの合計。応答の長さを変えると、**次のターン以降の
 * 入力が丸ごと変わる**（履歴に載るから）。見積りと上振れ側で同じ式を使うために切り出す。
 */
export const accumulatePromptTokens = (
  script: readonly { user: string }[],
  systemPrompt: string,
  characterName: string,
  replyChars: number,
): number => {
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let total = 0;
  for (const scripted of script) {
    history.push({ role: "user", content: scripted.user });
    const messages = buildMessagesForApi(history, systemPrompt, characterName) as ApiMessage[];
    total += messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    history.push({ role: "assistant", content: "あ".repeat(replyChars) });
  }
  return total;
};

/** 1ターンにつき飛びうるリクエストの上限（初回 + 撮り直し） */
export const MAX_ATTEMPTS_PER_TURN = TRANSPORT_RETRY_DELAYS_MS.length + 1;

/**
 * 見積りの幅。**撮り直しも課金される。**429 と 5xx で撮り直すので、荒れた条件やと
 * 1ターンにつき MAX_ATTEMPTS_PER_TURN 回まで飛ぶ。1回きりの数字だけ出しとったら、
 * 上振れをその倍率ぶん見落としたまま `--spend` を押すことになる
 */
export const estimateCostRange = (
  promptTokens: number,
  completionTokens: number,
  pricing: Pricing,
): { once: number; ceiling: number } => {
  const once = promptTokens * pricing.promptPerToken + completionTokens * pricing.completionPerToken;
  return { once, ceiling: once * MAX_ATTEMPTS_PER_TURN };
};

const callOpenRouterOnce = async (
  messages: ApiMessage[],
  options: Options,
  apiKey: string,
): Promise<{
  text: string;
  latencyMs: number;
  error: string | null;
  finishReason: string | null;
}> => {
  const startedAt = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        // 一部の qwen モデルは provider.allow_fallbacks が無いと
        // 400 INVALID_REQUEST_BODY を返す（script/bench/ttft-bench.ts:108-118 の実測）。
        // 本番と同じ関数で組む。付けんと --model qwen/... の条件が API エラーしか記録せん
        provider: buildOpenRouterProviderRouting(options.model, options.maxTokens),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      return { text: "", latencyMs, error: `[API_ERROR:${res.status}]`, finishReason: null };
    }
    return { ...readCompletion(await res.json()), latencyMs };
  } catch (error) {
    return {
      text: "",
      latencyMs: Date.now() - startedAt,
      error: `[INFRA_ERROR:${error instanceof Error ? error.message : String(error)}]`,
      finishReason: null,
    };
  }
};

const callOpenRouter = async (
  messages: ApiMessage[],
  options: Options,
  apiKey: string,
): Promise<{
  text: string;
  latencyMs: number;
  error: string | null;
  finishReason: string | null;
  retries: number;
}> => {
  // 待ち時間も含めて外側で測る。最後の試行だけやと、不安定な条件ほど実際の待ちを
  // 少なく報告してまう（2/5/10 秒の backoff が丸ごと消える）。
  const startedAt = Date.now();
  let attempt = 0;
  let last = await callOpenRouterOnce(messages, options, apiKey);
  while (last.error !== null && attempt < TRANSPORT_RETRY_DELAYS_MS.length) {
    const status = Number.parseInt(/\[API_ERROR:(\d+)\]/.exec(last.error)?.[1] ?? "0", 10);
    const retryable = status === 0 ? last.error.startsWith("[INFRA_ERROR") : isRetryable(status);
    if (!retryable) break;
    await sleep(TRANSPORT_RETRY_DELAYS_MS[attempt]);
    attempt += 1;
    last = await callOpenRouterOnce(messages, options, apiKey);
  }
  return { ...last, latencyMs: Date.now() - startedAt, retries: attempt };
};

/**
 * vlong-dogfood と同じヘッダ形式。corpus.ts がそのまま読める。
 * ただし `servedPhase` は**サーバの判定やのうて** detectScenePhase のローカル推定で、
 * しかも台本の user 発話が intent を狙って書かれとるので intent とほぼ一致する。
 * 独立した情報を持っとらんと思って読むこと（床の決定にはこの値が効く）。
 */
const renderTurnFile = (record: {
  character: string;
  turn: number;
  intent: ScenePhase;
  servedPhase: ScenePhase;
  model: string;
  visibleChars: number;
  innerChars: number;
  latencyMs: number;
  error: string | null;
  finishReason: string | null;
  /** このターンを引き出した user 発話の文字数。床の判定に効く */
  userChars: number;
  body: string;
}): string =>
  [
    `# character: ${record.character}`,
    `# turn: ${record.turn}`,
    `# intent: ${record.intent}`,
    `# servedPhase: ${record.servedPhase}`,
    `# servedModel: ${record.model}`,
    `# visibleChars: ${record.visibleChars}  innerChars: ${record.innerChars}  latencyMs: ${record.latencyMs}`,
    `# error: ${record.error ?? "-"}`,
    `# finishReason: ${record.finishReason ?? "-"}`,
    `# userChars: ${record.userChars}`,
    // **ヘッダと本文の区切り。**空けとかんと、本文の1行目が `# userChars: 100` の形を
    // しとった時に読み込み側がヘッダとして食う（床の判定がその行で決まる）
    "",
    record.body,
  ].join("\n");

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const characterId = DOGFOOD_CHARACTER_IDS[options.character];
  const character = loadCharacter(characterId, options.characterSource);
  const script = BENCH_SCRIPTS[options.character].slice(0, options.turns);

  console.log(`# bench:generate — ${options.character}（${character.name}）`);
  console.log(
    `条件: run=${options.run} arm=${conditionArmOf(options, character)} model=${options.model} turns=${options.turns}`,
  );
  console.log(
    `キャラシート: ${character.systemPrompt.length} 字（経路 ${character.source}。本番 D1 と一致する保証は無い）`,
  );
  console.log(`自動で足される指示: ${ADAPTER_INJECTED_REMINDERS}\n`);

  const systemPrompt = `${character.systemPrompt}\n\n${OUTPUT_FORMAT_INSTRUCTION}`;
  const history: { role: "user" | "assistant"; content: string }[] = [];

  // 入力は履歴と一緒に伸びる。1ターン目 × ターン数で数えると桁で外れる
  // （実測: 10ターンの smoke run で見積り 10,260 に対し実際 19,280 トークン）。
  // ターンを積み上げて、各ターンの入力を足す。
  const firstMessages = buildMessagesForApi(
    [{ role: "user", content: script[0].user }],
    systemPrompt,
    character.name,
  ) as ApiMessage[];
  const promptTokensFor = (replyChars: number): number =>
    accumulatePromptTokens(script, systemPrompt, character.name, replyChars);
  const estimatedPromptTokens = promptTokensFor(ASSUMED_REPLY_CHARS);
  // **上振れ側の見積り。**応答が長いほど次のターンの入力も膨らむので、median の応答を
  // 仮定したまま「上限」と書いたら、`--max-tokens 32000` の条件で実際の請求が上回る。
  // 毎ターン上限まで出した履歴で計算し直す。**ただし本物の上限やない**:
  // ここは1トークン=1文字で数えとるので、1トークンが複数文字へ展開されたら
  // 履歴はこれより長くなる。桁を外してへんかの確認に使う数字であって、請求額やない
  const heavyPromptTokens = promptTokensFor(options.maxTokens);
  const pricing = await fetchPricing(options.model);
  const estimatedCompletionTokens = options.maxTokens * options.turns;
  console.log(`## 概算`);
  console.log(
    `- 入力 ${estimatedPromptTokens.toLocaleString()} トークン` +
      `（履歴の伸びこみ。応答を1ターン ${ASSUMED_REPLY_CHARS} 字と仮定）`,
  );
  console.log(`- 出力上限 ${estimatedCompletionTokens.toLocaleString()} トークン`);
  if (pricing) {
    const { once } = estimateCostRange(estimatedPromptTokens, estimatedCompletionTokens, pricing);
    const { ceiling } = estimateCostRange(heavyPromptTokens, estimatedCompletionTokens, pricing);
    console.log(`- 概算コスト **$${once.toFixed(4)}**（OpenRouter の公開価格 × 上の見積り）`);
    console.log(
      `- 上振れの目安 **$${ceiling.toFixed(4)}**` +
        `（毎ターン上限まで出して履歴が膨らみ、なおかつ1ターンにつき ${MAX_ATTEMPTS_PER_TURN} 回` +
        `撮り直した場合。429 と 5xx で撮り直す）`,
    );
    console.log(
      `- トークン数は**1文字1トークンの近似**なので、これも上限の保証やない。` +
        `請求額の予測やのうて、桁を外してへんかの確認に使う\n`,
    );
  } else {
    console.log(`- 価格を引けんかった。コストは自分で確かめること\n`);
  }

  if (!options.spend) {
    console.log(`## dry-run（--spend を付けるまで1回も発行せん）\n`);
    console.log(`### 1ターン目に送る messages（${firstMessages.length} 通）\n`);
    for (const message of firstMessages) {
      console.log(
        `- **${message.role}** (${message.content.length}字): ${message.content.slice(0, 120).replace(/\n/g, " ")}…`,
      );
    }
    console.log(`\n### 台本`);
    for (const [index, turn] of script.entries()) {
      console.log(`${index + 1}. [${turn.intent}] ${turn.user}`);
    }
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY が無い（.env を復号して環境へ載せること）");

  const customOut = options.outDir !== DEFAULT_OUT_DIR;
  const runDir = path.join(options.outDir, options.run);
  // 既にある run へ書くと、ターンのファイル名が決まっとるので上書きし、summary が
  // 2本になって loadRunConfig が落ちる（**古い run と買うたばかりの run が両方読めんようになる**）。
  // 発行前に弾く
  if (existsSync(runDir) && readdirSync(runDir).length > 0) {
    throw new Error(`run ディレクトリが既にある: ${runDir}（--run で別の名前を付けること）`);
  }
  // **run ディレクトリを原子的に取る。**存在確認と `recursive: true` の作成やと、
  // 同じ `--run` で2本同時に走った時に両方が確認を通り抜けて、**両方が課金してから**
  // 同じファイル名を上書きし合う（summary も2本になって loadRunConfig が落ちる）。
  // `recursive` 無しの mkdir は既にあれば EEXIST で落ちるので、これが取り合いの決着になる
  mkdirSync(options.outDir, { recursive: true });
  try {
    mkdirSync(runDir);
  } catch (error) {
    throw new Error(
      `run ディレクトリを取れんかった: ${runDir}（同じ --run が同時に走っとらんか）`,
      { cause: error },
    );
  }
  const records: unknown[] = [];

  // **宣言した設定を、1回も発行せんうちに書く。**最後にだけ書いとった間、
  // 途中で落ちた run は summary の無いディレクトリとして残り、`loadRunConfig` は
  // それを「設定の記録が無い run」として受ける。すると `--turns` が読めんので、
  // 途中終了の判定が「記録の在る一番後ろのターン」に落ちて、**落ちた run が完走に見える**。
  // 課金した run ほど、この形で残る（落ちるのは発行の途中やから）。
  const runId = String(Date.now());
  const summaryPath = path.join(runDir, `summary-session-${options.run}-${runId}.json`);
  // **書き換えは一時ファイル経由。**`writeFileSync` は先に中身を切り詰めるので、
  // 締めの書き直しの途中で落ちると**壊れた JSON が残る**。`parseRunSummary` の
  // `JSON.parse` は捕まえてへんので、そうなると **bench-run のコーパス全体が読めん**
  // ようになる（課金済みのターンごと）。rename なら、落ちても前の版が残る
  const writeSummary = (): void => {
    writeJsonAtomic(summaryPath, buildRunSummary(options, runId, character, records));
  };
  writeSummary();

  for (const [index, scripted] of script.entries()) {
    history.push({ role: "user", content: scripted.user });
    const messages = buildMessagesForApi(history, systemPrompt, character.name) as ApiMessage[];
    const servedPhase = detectScenePhase(messages);
    const { text, latencyMs, error, finishReason, retries } = await callOpenRouter(
      messages,
      options,
      apiKey,
    );
    const parsed = parseXmlResponse(text);
    const visibleChars = countUiVisibleChars(text);
    const innerChars = parsed?.inner?.length ?? 0;
    const turnNumber = index + 1;

    // ターンの記録も一時ファイル経由。途中で落ちて**書きかけの .txt** が残ると、
    // 次の `bench:score` がそれを本物の応答として読んで、長さも XML の不良も歪む
    // （課金済みのリクエストの記録が、静かに別物になる）
    writeFileAtomic(
      path.join(
        runDir,
        `${options.character}-${String(turnNumber).padStart(2, "0")}-session-${options.run}-${options.model.replace(/\//g, "_")}.txt`,
      ),
      renderTurnFile({
        character: options.character,
        turn: turnNumber,
        intent: scripted.intent,
        servedPhase,
        model: options.model,
        visibleChars,
        innerChars,
        latencyMs,
        error,
        finishReason,
        userChars: scripted.user.length,
        body: text,
      }),
    );
    records.push({
      index: turnNumber,
      intent: scripted.intent,
      servedPhase,
      servedModel: options.model,
      visibleChars,
      innerChars,
      latencyMs,
      transportRetries: retries,
      finishReason,
      userChars: scripted.user.length,
      error: error ?? "None",
    });
    console.log(
      `turn${turnNumber} [${scripted.intent}→${servedPhase}] ${visibleChars}字 ${latencyMs}ms ` +
        `${retries > 0 ? `retry×${retries} ` : ""}` +
        `${finishReason === "length" ? "上限切れ " : ""}${error ?? ""}`,
    );
    // エラーを本文として履歴へ積むと、次ターン以降が壊れた文脈で走る。
    // ただし user 発話は消さん。実際に言うた台詞を消すと、以降のターンの台本が別物になる。
    // 積むかどうかも**読み込み側と同じ判定**で決める（`hasReadableResponseContent`）
    if (!error && hasVisibleReply(text)) {
      history.push({ role: "assistant", content: text });
    }

    const stop = stopReasonFor({ error, finishReason, text }, options.maxTokens);
    if (stop !== null) {
      console.log(`  ${stop}`);
      break;
    }
  }

  // ターンを書き足したので、記録を最新にして締める
  writeSummary();

  console.log(`\n出力: ${runDir}`);
  console.log(
    `測る: pnpm bench:score --source bench-run${customOut ? ` --bench-runs ${options.outDir}` : ""}`,
  );
};

// import しただけで課金の入口を走らせん。直接起動した時だけ
if (process.argv[1] !== undefined && process.argv[1].endsWith("generate.ts")) await main();
