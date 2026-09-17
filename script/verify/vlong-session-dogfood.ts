/**
 * vlong-session-dogfood.ts — 実利用を再現して全ターンの本文を残す。
 *
 * 既存の vlong-prod-check.ts は履歴ゼロの単発メッセージに scenePhase を強制して
 * 6 回生成するだけで、実ユーザーが 15 ターン以上の会話を経てエロに入る道筋を
 * 一度も通らん。長さゲートとしては使えても、体験の判定には使えん。
 *
 * session モード: 履歴を積んで通しで演じる。scenePhase は強制せずサーバ判定に任せる。
 * matrix  モード: scenePhase を強制した 1 ターン測定。長さの単調性ゲート用。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildMessagesForApi } from "../../src/lib/chat-message-adapter";
import { parseXmlResponse } from "../../src/lib/xml-response-parser";
import { describeChatSseFailure, readChatSseResponse } from "../lib/read-chat-sse";
import type { ChatSseSnapshot } from "../lib/read-chat-sse";
import { buildChatHeaders, buildMessagePersistBody, isScenePhase } from "./vlong-session-request-shape";

type ResponseLength = "short" | "medium" | "long" | "very_long";
type ScenePhase = "conversation" | "intimate" | "erotic" | "climax" | "afterglow";

// アプリの出荷既定（`src/store/settings-store.ts` の persistedSettingsSchema）と同じ値。
// store を import すると React ごと引っぱるので、値を写して
// `vlong-session-request-shape.test.ts` で食い違いを落とす。
const DEFAULT_RESPONSE_LENGTH: ResponseLength = "medium";

type ScriptedTurn = {
  /** 台本上の狙い。サーバが実際にどの phase を選んだかは応答ヘッダで確認する。 */
  intent: ScenePhase;
  user: string;
};

type TurnRecord = {
  index: number;
  intent: ScenePhase;
  servedPhase: string | null;
  servedModel: string | null;
  // どの経路（リトライ・拒否検知・警告）がこのターンを出したかは servedModel だけでは
  // 読めん。後から読む側が exit の由来を追えるよう、サーバの quality-meta をそのまま残す。
  qualityMeta: ChatSseSnapshot["qualityMeta"];
  visibleChars: number;
  innerChars: number;
  plainChars: number;
  latencyMs: number;
  error: string | null;
  /** 転送レベルで取り直した回数。0 でないターンは体験としては失敗しとる。 */
  transportRetries: number;
  /** そのターンで送った相手の発言。これが無いと「発言の細部を拾えとるか」を読んで判定でけん。 */
  userTurn: string;
  text: string;
};

const CHARACTERS = {
  sakura: { id: "char-koharu-ex", label: "Sakura" },
  downer: { id: "import-charap-ダウナーお姉さんに拾われる話", label: "Downer" },
} as const;

type CharacterKey = keyof typeof CHARACTERS;

// 台本は「実ユーザーが打ちそうな長さのばらつき」をそのまま持たせる。短い促しと
// 書き込んだターンが混ざらんと、応答長が相手の熱量に追従しとるかを読めん。
const SCRIPTS: Record<CharacterKey, ScriptedTurn[]> = {
  sakura: [
    { intent: "conversation", user: "急に声かけてごめん。……でも、ずっとひとりで本を読んでるきみのことが気になって。少しだけ、話してもいい？" },
    { intent: "conversation", user: "俺の奢りだから、好きなの頼んで。……きみ、甘いのが好きそうだなって思ってた。当たってる？" },
    { intent: "conversation", user: "その本、同じページばっかり読み返してたよ。……考えごと、してた？" },
    { intent: "intimate", user: "……ごめん、近づきすぎたかな。でも、きみに触れてみたかった。……手、貸して" },
    { intent: "intimate", user: "髪、耳にかかってるね。取ってあげる。……首筋、赤くなってるよ。きみの緊張、ぜんぶここに出てる" },
    // 実測(2026-08-16)で分かった台本の欠陥: カフェから一度も移動せんまま erotic/climax を
    // 要求しとった。モデルは公共の場で性行為を書かんので、9ターン全部が「小道具が動いて
    // 体が震える」に化ける。実ユーザーはここで場所を変える。台本にも入れる。
    { intent: "intimate", user: "……ねえ、このまま別れるの、もったいないと思わない？　うち、すぐ近くなんだ。帰ってもいいよ。でもきみは、帰りたい顔してないよ" },
    { intent: "erotic", user: "……ここまで来て、まだ我慢するつもり？　体は正直だよ。さっきから、きみの震えが手に伝わってる" },
    { intent: "erotic", user: "……もっと触らせて。綺麗な声、隠さないで。……ここまで来て、まだ素直になれないの？" },
    { intent: "climax", user: "……もう我慢しないでいい。きみの中で受け止めてほしい。……全部、俺に預けて" },
    { intent: "afterglow", user: "……大丈夫？　汗、拭いてあげる。……きみのこと、ぜんぶ俺のものにしたかったんだ。……今、どんな気持ち？" },
  ],
  downer: [
    { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
    { intent: "conversation", user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど" },
    { intent: "conversation", user: "なんで俺なんか拾ったの" },
    { intent: "intimate", user: "……その距離、わざと？" },
    { intent: "intimate", user: "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。" },
    { intent: "intimate", user: "……ベッド、そっちだよね。連れてって。" },
    { intent: "erotic", user: "逃がす気ないんでしょ。分かってるよ。" },
    { intent: "erotic", user: "そのまま、上から" },
    { intent: "climax", user: "……出る。全部きみの中に。" },
    { intent: "afterglow", user: "……まだ離してくれないんだ。" },
  ],
};

const MATRIX_PHASES: ScenePhase[] = ["conversation", "intimate", "erotic", "climax", "afterglow"];
// 4 段のうち long を測っとらんかった。L1 の「UI の 4 段が実際に 4 段の長さになる」は
// 4 段全部の実測が要る。測らん段が 1 つでもあると、そこだけ誰にも確かめられんまま残る。
const MATRIX_LENGTHS: ResponseLength[] = ["short", "medium", "long", "very_long"];
const MATRIX_PROMPT_SHORT = "もっと";
const MATRIX_PROMPT_LONG =
  "さっきからずっと考えてた。今この瞬間のきみの息づかいも、指先の温度も、全部覚えていたい。だから、ちゃんと見せて。";

// 段ごとの前置き。matrix は 1 発の単発リクエストなので、climax を指定しても
// 直前に何も起きとらん状態から始まってまう。実測 2026-08-18 matrix02 では
// climax の 8 セル全部に性的な描写が 1 文字も無かった（`イッ|絶頂|射精|中に出|精液|膣|挿入` が 0 件）。
// 測っとるのは「その段の応答」やのうて「その段の名前を付けた初対面」やった。
// 本番と同じ形にするため、その段に至るまでの往復を 1 つだけ積む。
const MATRIX_PRELUDE: Partial<Record<ScenePhase, { user: string; assistant: string }>> = {
  intimate: {
    user: "ふたりきりになれたな。",
    assistant:
      "<response><action>肩が触れる距離で、視線がゆっくり絡む。</action><dialogue>「…うん。誰もおらんね」</dialogue><inner>心臓がうるさい。</inner></response>",
  },
  erotic: {
    user: "もう我慢でけへん。",
    assistant:
      "<response><action>服の合わせが解け、素肌に手のひらが触れる。息が浅くなる。</action><dialogue>「…そこ、あつい」</dialogue><inner>止まらへん。</inner></response>",
  },
  climax: {
    user: "そのまま、奥まで。",
    assistant:
      "<response><action>奥を突かれるたびに背が反り、内側が締まって離さん。汗が伝う。</action><dialogue>「あ、っ…も、だめ、いきそう…っ」</dialogue><inner>頭が真っ白になる。</inner></response>",
  },
  afterglow: {
    user: "……すごかった。",
    assistant:
      "<response><action>まだ震える体を預けたまま、胸が上下しとる。中に残った熱が重い。</action><dialogue>「…うごけへん」</dialogue><inner>まだ余韻が引かん。</inner></response>",
  },
};

const arg = (name: string): string | undefined => {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const loadVars = (): Record<string, string> => {
  const path = resolve(process.cwd(), ".prod-verify.vars");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
};

const vars = loadVars();
const BASE_URL = process.env.BASE_URL ?? vars["PROD_BASE_URL"] ?? "http://127.0.0.1:8788";
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? vars["AUTH_TOKEN"] ?? "";
const MODE = (arg("mode") ?? "session") as "session" | "matrix";
const ARM = arg("arm") ?? "base";
const RUN_ID = arg("run") ?? String(process.hrtime.bigint()).slice(-8);
// 既定はアプリの出荷既定と同じにする。ここが very_long やった間、読解アーム 22 本は
// 全部「局長が使っとらん設定」を測っとった。route-context.ts:4473-4482 は長さで別の
// 長文指示を渡すので、very_long だけ測っても既定の経路の欠陥は一つも見えん
// （実例: 交互の指示が very_long 側にだけ入っとった件）。
const RESPONSE_LENGTH = (arg("length") ?? DEFAULT_RESPONSE_LENGTH) as ResponseLength;
const EXPECT_MODEL = arg("expect-model") ?? null;
// #1481 の切り分け用。会話帯の既定は qwen で、その qwen が前ターンと同じ文を丸ごと出す
// （phase26 で 5/5）。routing のせいかモデルのせいかは、同じ台本を別モデルで 1 通し
// 測らんと決まらん。/api/chat の model は元から client 指定を受ける（route-context.ts:1060）
// ので、サーバは 1 行も変えんで済む。
const FORCE_MODEL = arg("model") ?? null;
const CHARACTER_KEYS = (arg("chars") ?? "sakura,downer").split(",") as CharacterKey[];

// 104 秒かかるターンが黙って通ると、壁時計 85 秒を超えた失敗が成功として記録される。
const REQUEST_TIMEOUT_MS = Number(process.env.DOGFOOD_TIMEOUT_MS ?? 120_000);
// 1 ターンの 502 で 9 ターンの通しを捨てんための取り直し上限。品質リトライとは別物。
const TRANSPORT_RETRIES = Number(process.env.DOGFOOD_TRANSPORT_RETRIES ?? 2);
// COST_ESTIMATES.chat = 10 cents/call。使い切りを事故でなく設計で防ぐ。
const COST_PER_CALL_CENTS = 10;
const BUDGET_CENTS = Number(process.env.VLONG_BUDGET_CENTS ?? 1700);

const DATE = arg("date") ?? new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(process.cwd(), `.work/e2e-results/vlong-dogfood/${DATE}-${ARM}`);

// 可視文字数は UI が実際に見せる分だけ。<inner> は非表示なので含めん。
const countVisible = (text: string): number => {
  const parsed = parseXmlResponse(text);
  if (!parsed) return text.replace(/\s+/g, "").length;
  return [parsed.scene, parsed.action, parsed.dialogue, parsed.narration]
    .filter((s): s is string => typeof s === "string")
    .join("")
    .replace(/\s+/g, "").length;
};

const countInner = (text: string): number =>
  parseXmlResponse(text)?.inner?.replace(/\s+/g, "").length ?? 0;

type CharacterRow = { id: string; name: string; systemPrompt: string };

// augmentMessages(route-context.ts:6183-6193) は「既にある system メッセージ」を書き換える
// だけで、無ければキャラ設定は一度も注入されん。characterId だけ送るとキャラ不在の
// 素のモデルを測ることになるので、実クライアント(ou-app.tsx:1367)と同じく
// buildMessagesForApi 経由で system を先頭に置く。
const fetchCharacter = async (id: string): Promise<CharacterRow> => {
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(new URL("/api/characters", BASE_URL).toString(), { headers });
  if (!res.ok) throw new Error(`GET /api/characters failed: ${res.status}`);
  const body = (await res.json()) as { characters: CharacterRow[] };
  const found = body.characters.find((c) => c.id === id);
  if (!found) throw new Error(`character not found: ${id}`);
  if (!found.systemPrompt) throw new Error(`character has empty systemPrompt: ${id}`);
  return found;
};

// 実クライアント(ou-app.tsx:1208 ensureConversation → src/lib/api.ts:952 createConversation)
// と同じく、通しの全ターンで使い回す会話を先に1つ作る。会話が無いと x-conversation-id を
// 送りようがなく、fetchLastAssistantGenerationPhase が常に null を返して applyPhaseFloor が
// 一度も効かんまま計測することになる。
// 会話を作った時にサーバが挨拶を1行目の assistant として保存する
// （functions/api/routes/conversations.ts:190-195）。実クライアントもそれを
// 画面へ積む（ou-app.tsx の addConversationGreetingMessage）。ここが挨拶を積んでへんと、
// turn 1 は本番が一度も送らん形の要求（system + user だけ）を測ることになる。
const createConversationForCharacter = async (
  characterId: string,
  title: string,
): Promise<{ id: string; greeting: string }> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(new URL("/api/conversations", BASE_URL).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ title, characterId }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/conversations failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    conversation: { id: string; characterGreeting?: string; greetingMessageId?: string | null };
  };
  const { id, characterGreeting, greetingMessageId } = body.conversation;
  // greetingMessageId が無い時はサーバも行を作っとらん。実クライアントも同じ条件で積まん。
  return {
    id,
    greeting: greetingMessageId && characterGreeting?.trim() ? characterGreeting : "",
  };
};

// 実クライアント(src/lib/api.ts:1301 createConversationMessage)と同じ body 形。
// 保存が失敗しても飲み込まん。飲み込むと次ターンの fetchLastAssistantGenerationPhase が
// また null に戻り、applyPhaseFloor が効かんまま先の計測が続く。
const persistMessage = async (
  conversationId: string,
  message: { id: string; role: "user" | "assistant"; content: string; generationPhase?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  try {
    const res = await fetch(
      new URL(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        BASE_URL,
      ).toString(),
      {
        method: "POST",
        headers,
        body: JSON.stringify(buildMessagePersistBody(message)),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `POST /messages(${message.role}) failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `POST /messages(${message.role}) threw: ${String(err).slice(0, 300)}` };
  }
};

const toApiMessages = (
  character: CharacterRow,
  history: { role: "user" | "assistant"; content: string }[],
) =>
  buildMessagesForApi(
    history.map((m) => ({ ...m, isStreaming: false })),
    character.systemPrompt,
    character.name,
  );

const postChat = async (payload: unknown, conversationId?: string, assistantMessageId?: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "adult-ai-vlong-dogfood/1.0",
      ...buildChatHeaders(conversationId, assistantMessageId),
    };
    if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;

    const res = await fetch(new URL("/api/chat", BASE_URL).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (res.status !== 200) {
      return {
        ok: false as const,
        status: res.status,
        latencyMs,
        body: (await res.text()).slice(0, 300),
      };
    }
    const snapshot = await readChatSseResponse(res.body as ReadableStream<Uint8Array>);
    return {
      ok: true as const,
      latencyMs,
      snapshot,
      servedPhase: res.headers.get("x-scene-phase"),
      failure: describeChatSseFailure(snapshot),
    };
  } catch (err) {
    return {
      ok: false as const,
      status: 0,
      latencyMs: Date.now() - startedAt,
      body: String(err).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
};

const toRecord = (
  index: number,
  intent: ScenePhase,
  result: Awaited<ReturnType<typeof postChat>>,
  userTurn: string,
): TurnRecord => {
  if (!result.ok) {
    return {
      index,
      intent,
      servedPhase: null,
      servedModel: null,
      qualityMeta: null,
      visibleChars: 0,
      innerChars: 0,
      plainChars: 0,
      latencyMs: result.latencyMs,
      error: `HTTP ${result.status}: ${result.body}`,
      transportRetries: 0,
      userTurn,
      text: "",
    };
  }
  const text = result.snapshot.text;
  return {
    index,
    intent,
    servedPhase: result.servedPhase,
    servedModel: result.snapshot.servedModel,
    qualityMeta: result.snapshot.qualityMeta,
    visibleChars: countVisible(text),
    innerChars: countInner(text),
    plainChars: text.replace(/\s+/g, "").length,
    latencyMs: result.latencyMs,
    error: result.failure,
    transportRetries: 0,
    userTurn,
    text,
  };
};

// ファイル名に arm・servedModel・runId を載せる。固定名やと 2 本目のアームが
// 1 本目の証跡を上書きして、読むべき本文そのものが消える。
// サーバの quality-meta は refusalRetryCount と**同じ値**を retryCount という名前でも出す。
// 名前だけ見ると「品質の撮り直し回数」に読めるが、中身は拒否ラベルでの撮り直しだけ。
// 実際 2026-08-20 の phase66 通読で「climax の床が発火しとらん」と誤読した根拠がこれやった
// （罠 §5-2 の `char_length` と同じ形。名前と中身が食い違う列を根拠にすると必ず読み違える）。
// ダンプには曖昧な名前の方を書かん。品質の撮り直し回数はここからは読めん、が正しい状態や。
const formatQualityMeta = (meta: TurnRecord["qualityMeta"]): string => {
  if (!meta) return "(none)";
  const { retryCount: _ambiguous, ...rest } = meta;
  return JSON.stringify(rest);
};

const writeTurn = (charLabel: string, record: TurnRecord, suffix: string) => {
  const model = (record.servedModel ?? "none").replace(/[^a-zA-Z0-9.-]/g, "_");
  const name = `${charLabel}-${String(record.index).padStart(2, "0")}-${suffix}-${ARM}-${model}-${RUN_ID}.txt`;
  const header = [
    `# character: ${charLabel}`,
    `# turn: ${record.index}`,
    `# intent: ${record.intent}`,
    `# servedPhase: ${record.servedPhase ?? "(none)"}`,
    `# servedModel: ${record.servedModel ?? "(none)"}`,
    `# quality: ${formatQualityMeta(record.qualityMeta)}`,
    `# visibleChars: ${record.visibleChars}  innerChars: ${record.innerChars}  latencyMs: ${record.latencyMs}`,
    `# error: ${record.error ?? "-"}`,
    "# --- そのターンで送った相手の発言 ---",
    ...record.userTurn.split("\n").map((line) => `# > ${line}`),
    "# --- ここから本文 ---",
    "",
  ].join("\n");
  writeFileSync(resolve(OUT_DIR, name), header + record.text, "utf8");
};

const runSession = async (key: CharacterKey): Promise<TurnRecord[]> => {
  const { id, label } = CHARACTERS[key];
  const character = await fetchCharacter(id);
  const script = SCRIPTS[key];
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const records: TurnRecord[] = [];

  // 実クライアント(ou-app.tsx:1208)と同じく、通しの全ターンで1つの会話 id を使い回す。
  const { id: conversationId, greeting } = await createConversationForCharacter(
    id,
    `vlong-dogfood-${ARM}-${RUN_ID}-${label}`,
  );
  // 保存はサーバが済ませとる。ここで persistMessage を呼ぶと2行になる。
  if (greeting) history.push({ role: "assistant", content: greeting });

  for (const [i, turn] of script.entries()) {
    history.push({ role: "user", content: turn.user });
    // 実クライアント(ou-app.tsx の resolveSendAssistantId)と同じく、リクエストより前に採番する。
    // 後で採番すると、チャット呼び出しに id を載せられず quality_measurement.message_id が
    // NULL のままになる（実測 2026-08-20 phase55 で紐づき 0 件）。
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    // scenePhase は送らん。アプリと同じくサーバの検出に任せんと、実利用の道筋を測れん。
    const result = await postChat(
      {
        messages: toApiMessages(character, history),
        safeMode: false,
        characterId: id,
        responseLength: RESPONSE_LENGTH,
        ...(FORCE_MODEL ? { model: FORCE_MODEL } : {}),
      },
      conversationId,
      assistantMessageId,
    );
    // 品質リトライが枯渇すると 502 で本文ごと落ちる（実測: too_short → english_leak →
    // repetition → upstream_error）。1 ターンの事故で 9 ターンの通しを捨てんよう、
    // 転送レベルでだけ取り直す。取り直した事実は記録に残す。
    let attempt = result;
    let transportRetries = 0;
    while (transportRetries < TRANSPORT_RETRIES && (!attempt.ok || attempt.failure)) {
      transportRetries += 1;
      console.log(`  retrying turn ${i + 1} (transport attempt ${transportRetries})`);
      attempt = await postChat(
        {
          messages: toApiMessages(character, history),
          safeMode: false,
          characterId: id,
          responseLength: RESPONSE_LENGTH,
        },
        conversationId,
        assistantMessageId,
      );
    }

    const record = toRecord(i + 1, turn.intent, attempt, turn.user);
    record.transportRetries = transportRetries;

    // 実クライアント(ou-app.tsx:1440 persistCompletedTurn)と同じく、ストリーム完了後に
    // user・assistant の両方を保存する。ここを飲み込むと次ターンの
    // fetchLastAssistantGenerationPhase がまた null に戻り、applyPhaseFloor が効かんまま
    // 計測が続く。保存失敗は転送失敗と同じ扱いでターンのエラーにする。
    if (!record.error && record.text) {
      const userSave = await persistMessage(conversationId, {
        id: userMessageId,
        role: "user",
        content: turn.user,
      });
      if (!userSave.ok) {
        record.error = userSave.error;
      } else if (!isScenePhase(record.servedPhase)) {
        // servedPhase が読めんと次ターンの床を正しく再現できん。黙って続けん。
        record.error = `assistant persist skipped: invalid servedPhase (${record.servedPhase ?? "null"})`;
      } else {
        const assistantSave = await persistMessage(conversationId, {
          id: assistantMessageId,
          role: "assistant",
          content: record.text,
          generationPhase: record.servedPhase,
        });
        if (!assistantSave.ok) record.error = assistantSave.error;
      }
    }

    records.push(record);
    writeTurn(label, record, "session");
    console.log(
      `[${label}] turn ${record.index} intent=${record.intent} served=${record.servedPhase ?? "-"} ` +
        `model=${record.servedModel ?? "-"} visible=${record.visibleChars} inner=${record.innerChars} ` +
        `${record.latencyMs}ms ${record.error ? `ERROR ${record.error}` : ""}`,
    );
    if (record.error || !record.text) break;
    history.push({ role: "assistant", content: record.text });
  }
  return records;
};

const runMatrix = async (key: CharacterKey): Promise<TurnRecord[]> => {
  const { id, label } = CHARACTERS[key];
  const character = await fetchCharacter(id);
  const records: TurnRecord[] = [];
  let index = 0;

  for (const phase of MATRIX_PHASES) {
    for (const length of MATRIX_LENGTHS) {
      for (const [energy, prompt] of [
        ["short", MATRIX_PROMPT_SHORT],
        ["long", MATRIX_PROMPT_LONG],
      ] as const) {
        index += 1;
        const prelude = MATRIX_PRELUDE[phase];
        const result = await postChat({
          messages: toApiMessages(character, [
            ...(prelude
              ? [
                  { role: "user" as const, content: prelude.user },
                  { role: "assistant" as const, content: prelude.assistant },
                ]
              : []),
            { role: "user", content: prompt },
          ]),
          safeMode: false,
          characterId: id,
          responseLength: length,
          scenePhase: phase,
          ...(FORCE_MODEL ? { model: FORCE_MODEL } : {}),
        });
        const record = toRecord(index, phase, result, prompt);
        records.push(record);
        writeTurn(label, record, `matrix-${phase}-${length}-${energy}`);
        console.log(
          `[${label}] ${phase}/${length}/${energy} model=${record.servedModel ?? "-"} ` +
            `visible=${record.visibleChars} ${record.latencyMs}ms ${record.error ?? ""}`,
        );
      }
    }
  }
  return records;
};

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const perCharacter =
    MODE === "session"
      ? SCRIPTS[CHARACTER_KEYS[0]].length
      : MATRIX_PHASES.length * MATRIX_LENGTHS.length * 2;
  const plannedCalls = CHARACTER_KEYS.length * perCharacter;
  const plannedCents = plannedCalls * COST_PER_CALL_CENTS;

  console.log(
    `mode=${MODE} arm=${ARM} run=${RUN_ID} base=${BASE_URL} length=${RESPONSE_LENGTH} model=${FORCE_MODEL ?? "(server default)"}`,
  );
  console.log(`planned calls: ${plannedCalls} (~${plannedCents} cents, budget ${BUDGET_CENTS})`);
  if (plannedCents > BUDGET_CENTS) {
    console.error(`ABORT: ${plannedCents} cents exceeds VLONG_BUDGET_CENTS=${BUDGET_CENTS}`);
    process.exit(2);
  }

  const all: { character: string; records: TurnRecord[] }[] = [];
  for (const key of CHARACTER_KEYS) {
    const records = MODE === "session" ? await runSession(key) : await runMatrix(key);
    all.push({ character: CHARACTERS[key].label, records });
    // 429 は枠の使い切り。続けても焼くだけなので、再開点を残して止める。
    if (records.some((r) => r.error?.includes("429"))) {
      writeFileSync(
        resolve(OUT_DIR, "resume.json"),
        JSON.stringify({ stoppedAt: CHARACTERS[key].label, mode: MODE, arm: ARM }, null, 2),
        "utf8",
      );
      console.error("ABORT: rate limited (429). resume.json written.");
      process.exit(3);
    }
  }

  const flat = all.flatMap((a) => a.records);
  const mismatched = EXPECT_MODEL
    ? flat.filter((r) => r.servedModel && r.servedModel !== EXPECT_MODEL)
    : [];

  console.log("\n=== SUMMARY ===");
  for (const { character, records } of all) {
    for (const r of records) {
      console.log(
        `${character}\tturn${r.index}\t${r.intent}\t→${r.servedPhase ?? "-"}\t` +
          `${r.servedModel ?? "-"}\tvisible=${r.visibleChars}\tinner=${r.innerChars}\t${r.latencyMs}ms` +
          `${r.error ? `\tERROR ${r.error}` : ""}`,
      );
    }
  }
  if (mismatched.length > 0) {
    // 遅いテールほど別モデルへ落ちる。黙って捨てるとアームの比較が有利側へ歪む。
    console.log(
      `\nDISCARDED (servedModel !== ${EXPECT_MODEL}): ${mismatched.length}/${flat.length} — ` +
        `reported, not dropped from the denominator`,
    );
    for (const r of mismatched) console.log(`  turn${r.index} served=${r.servedModel}`);
  }

  writeFileSync(
    resolve(OUT_DIR, `summary-${MODE}-${ARM}-${RUN_ID}.json`),
    JSON.stringify(
      { mode: MODE, arm: ARM, runId: RUN_ID, baseUrl: BASE_URL, responseLength: RESPONSE_LENGTH, results: all },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nwrote ${flat.length} turns to ${OUT_DIR}`);

  // 空の証跡をコミットした先例がある（.work/e2e-results/dogfood-1781902594 は
  // transcriptTurns: 0 のまま残っとる）。証拠として使えん run は成功にせん。
  const hollow: string[] = [];
  if (flat.length === 0) hollow.push("no turns recorded");
  const errored = flat.filter((r) => r.error);
  if (errored.length > 0) hollow.push(`${errored.length} turn(s) errored`);
  const modelless = flat.filter((r) => !r.servedModel);
  if (modelless.length > 0) hollow.push(`${modelless.length} turn(s) had no servedModel`);
  if (hollow.length > 0) {
    console.error(`\nFAIL (hollow evidence): ${hollow.join("; ")}`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
