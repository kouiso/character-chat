// /api/chat は1ターンで複数回の生成を線に載せる。不採用になった試行の data: も
// 採用した試行の data: も同じストリームに流れ、境界は `event: regenerating` だけで示される。
// data: 行しか見ないパーサは両方を連結してしまい、ユーザーに届いてない本文まで採点・
// 履歴投入してしまう。ブラウザ側(src/lib/api.ts)と同じ読み方をここに1本化する。

export type ChatSseSnapshot = {
  // 最後の作り直し以降に届いた本文。実際にユーザーへ配信されたものと一致する。
  text: string;
  // 実際に採用された本文を生成したモデル。quality-meta があればそれを正とする。
  // x-model-used ヘッダは1トークン目のモデルで固定されるため作り直しに追随せん。
  servedModel: string | null;
  regenerateCount: number;
  doneSignal: boolean;
  // event: error の理由。中継開始後の失敗は HTTP 200 のまま届くので、
  // これと doneSignal を見んと「途中で切れた本文」を正常な返答として採点してまう。
  errorReason: string | null;
  // quality-meta のうち usedModel 以外。どの経路（リトライ・拒否検知・警告）が
  // このターンを通したかは servedModel だけでは分からん。
  qualityMeta: {
    retryCount: number;
    refusalDetected: boolean;
    warningLevel: boolean;
    refusalRetryCount: number;
    // 生成を何回走らせたか。`retryCount` は refusalRetryCount の複製で品質の撮り直しを
    // 数えとらん。2026-08-20 の通読はその列を根拠に「climax の床が発火しとらん」と
    // 誤読しとる。サーバは既に送っとったのに、ここが捨てとった。
    generationCount: number | null;
    // 何で落ちたか。回数だけやと「撮り直したのに伸びてへん」のか「長さ以外で落ちて
    // 続き書きへ入れんかった」のかが見分けられん。
    deterministicCategory: string | null;
  } | null;
};

export type ChatSseCollectorOptions = {
  // 本文が届くたびに呼ぶ。TTFB 計測など行単位の観測が要る呼び出し元向け。
  onDelta?: (delta: string) => void;
};

export type ChatSseCollector = {
  pushLine: (line: string) => void;
  pushLines: (lines: string[]) => void;
  snapshot: () => ChatSseSnapshot;
};

type ChatSseDataPayload = {
  model?: string;
  text?: string;
  content?: string;
  choices?: { delta?: { content?: string } }[];
};

const stripPrefix = (line: string, prefix: string): string =>
  line.slice(line.startsWith(`${prefix} `) ? prefix.length + 1 : prefix.length).trim();

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 途中で切れたチャンクは無視する（次の読み取りで揃う）
    return null;
  }
};

export const createChatSseCollector = (options: ChatSseCollectorOptions = {}): ChatSseCollector => {
  let text = "";
  let deltaModel: string | null = null;
  let qualityMetaModel: string | null = null;
  let qualityMeta: ChatSseSnapshot["qualityMeta"] = null;
  let regenerateCount = 0;
  let doneSignal = false;
  let errorReason: string | null = null;
  let currentEvent: string | null = null;

  // 作り直しの境界は event 行そのもので閉じる。data 行が付かん形で届いても
  // 捨てるべき本文が残ってまうと、不採用の試行が採用本文の頭に連結される。
  const applyRegenerating = (): void => {
    text = "";
    deltaModel = null;
    regenerateCount += 1;
  };

  const applyNamedEvent = (eventType: string, raw: string): void => {
    // regenerating は event 行で処理済み。ここで再度数えると2回に見える。
    if (eventType === "regenerating") return;
    if (eventType === "error") {
      const payload = parseJson<{ reason?: string }>(raw);
      errorReason = payload?.reason ?? raw ?? "unknown";
      return;
    }
    if (eventType !== "quality-meta") return;
    const payload = parseJson<{
      usedModel?: string;
      retryCount?: number;
      refusalDetected?: boolean;
      warningLevel?: boolean;
      refusalRetryCount?: number;
      generationCount?: number;
      deterministicCategory?: string | null;
    }>(raw);
    if (!payload) return;
    if (payload.usedModel) qualityMetaModel = payload.usedModel;
    qualityMeta = {
      retryCount: payload.retryCount ?? 0,
      refusalDetected: payload.refusalDetected ?? false,
      warningLevel: payload.warningLevel ?? false,
      refusalRetryCount: payload.refusalRetryCount ?? 0,
      // 既定を 0 やのうて null にする。古いダンプ（このフィールドが無い頃のもの）を
      // 「撮り直しゼロ」と読み違えんため。
      generationCount: payload.generationCount ?? null,
      deterministicCategory: payload.deterministicCategory ?? null,
    };
  };

  const applyDataLine = (raw: string): void => {
    if (raw === "[DONE]") {
      doneSignal = true;
      return;
    }
    const payload = parseJson<ChatSseDataPayload>(raw);
    if (!payload) return;
    if (!deltaModel && payload.model) deltaModel = payload.model;
    const delta = payload.text ?? payload.content ?? payload.choices?.[0]?.delta?.content ?? "";
    if (!delta) return;
    text += delta;
    options.onDelta?.(delta);
  };

  const pushLine = (rawLine: string): void => {
    // 上流のフレームはそのまま中継されるので、CRLF で届くことがある。\r を残すと
    // 空行判定が外れ、以降の data 行が全部イベント配下の扱いになって本文が消える。
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      currentEvent = null;
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = stripPrefix(line, "event:");
      if (currentEvent === "regenerating") applyRegenerating();
      return;
    }
    // AI SDK 旧形式のテキストデルタ。名前付きイベントの配下には現れない。
    if (line.startsWith("0:")) {
      const legacy = parseJson<string>(line.slice(2));
      if (typeof legacy === "string" && legacy) {
        text += legacy;
        options.onDelta?.(legacy);
      }
      return;
    }
    if (!line.startsWith("data:")) return;
    const raw = stripPrefix(line, "data:");
    if (currentEvent !== null) {
      applyNamedEvent(currentEvent, raw);
      return;
    }
    applyDataLine(raw);
  };

  return {
    pushLine,
    pushLines: (lines) => {
      for (const line of lines) pushLine(line);
    },
    snapshot: () => ({
      text,
      servedModel: qualityMetaModel ?? deltaModel,
      regenerateCount,
      doneSignal,
      errorReason,
      qualityMeta,
    }),
  };
};

// [DONE] が来ていない、または error イベントが載ったターンは、本文が残っていても
// 途中で切れた失敗ターン。履歴投入や採点へ回すと実験結果が壊れる。
export const describeChatSseFailure = (snapshot: ChatSseSnapshot): string | null => {
  if (snapshot.errorReason) return `stream error: ${snapshot.errorReason}`;
  if (!snapshot.doneSignal) return "stream ended without [DONE]";
  return null;
};

export const parseChatSseBody = (
  body: string,
  options?: ChatSseCollectorOptions,
): ChatSseSnapshot => {
  const collector = createChatSseCollector(options);
  collector.pushLines(body.split("\n"));
  return collector.snapshot();
};

export const readChatSseResponse = async (
  body: ReadableStream<Uint8Array>,
  options?: ChatSseCollectorOptions,
): Promise<ChatSseSnapshot> => {
  const collector = createChatSseCollector(options);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      collector.pushLines(lines);
    }
    buffer += decoder.decode();
    if (buffer) collector.pushLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return collector.snapshot();
};
