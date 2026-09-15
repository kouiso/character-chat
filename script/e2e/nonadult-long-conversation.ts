import { evaluateLongConversation } from "../../src/lib/long-conversation-eval";
import { getDefaultModelForPhase } from "../../src/lib/model";
import { describeChatSseFailure, parseChatSseBody } from "../lib/read-chat-sse";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type NonAdultLongConversationTurn = {
  turn: number;
  latencyMs: number;
  assistantChars: number;
  servedModel: string | null;
};

export type NonAdultLongConversationResult = {
  scenarioId: "nonadult-daily-conversation-v1";
  phase: "conversation";
  turnCount: number;
  apiErrorCount: number;
  repetitionLoopOccurrences: number;
  repeatedTurnIndexes: number[];
  p95LatencyMs: number;
  lateTurn: {
    startTurn: 22;
    turnCount: number;
    repetitionLoopOccurrences: number;
    repeatedTurnIndexes: number[];
    p95LatencyMs: number;
  };
  thresholds: {
    maxLateTurnRepetitionLoopOccurrences: 0;
    maxLateTurnP95LatencyMs: 45_000;
  };
  passed: boolean;
  turns: NonAdultLongConversationTurn[];
};

type RunNonAdultLongConversationOptions = {
  baseUrl: string;
  email: string;
  authToken?: string;
  basicAuthUser?: string;
  basicAuthPass?: string;
  characterId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onTurn?: (turn: NonAdultLongConversationTurn) => void;
};

export const NON_ADULT_LONG_CONVERSATION_INPUTS = [
  "今日は全年齢の日常会話だけにしよう。まず最近の天気について話したい",
  "朝の散歩なら、川沿いと商店街のどちらが好き？",
  "散歩の途中で飲むなら、コーヒーと紅茶のどちらを選ぶ？",
  "静かな喫茶店で読みたい本のジャンルを教えて",
  "物語の舞台にするなら、海辺の町と山の町のどちらがいい？",
  "旅先で最初に見たいものは、景色と建物のどちら？",
  "写真を撮るなら、朝焼けと夕焼けのどちらが好き？",
  "雨の日に家でできる趣味を一つ勧めて",
  "その趣味を始めるなら、最初に何を用意すればいい？",
  "初心者が続けるための小さな目標を考えて",
  "休日の昼ごはんに簡単なメニューを提案して",
  "その料理に合う飲み物も選んで",
  "食後に聴くなら、落ち着いた音楽と明るい音楽のどちら？",
  "作業用の曲を選ぶときに大事にする点は何？",
  "集中が切れたときの短い休憩方法を教えて",
  "午後に近所を歩くなら、どんな道を選びたい？",
  "公園で見つけた季節の変化を一つ想像して",
  "その景色を短い日記にするなら、最初の一文は？",
  "日記を三日坊主にしない工夫を考えて",
  "夜の予定を立てるなら、映画と読書のどちらにする？",
  "映画を選ぶとき、雰囲気と物語のどちらを重視する？",
  "さっき話した海辺の町を舞台に、穏やかな出来事を考えて",
  "その町の主人公には、どんな仕事が似合う？",
  "主人公が毎朝立ち寄る場所を一つ決めて",
  "そこで出会う近所の人の特徴を考えて",
  "二人が協力して解決する小さな困りごとは何？",
  "解決のために最初に試す方法を提案して",
  "うまくいかなかった場合の別案も考えて",
  "最後に町の一日を締めくくる景色を描写して",
  "明日の朝に五分でできる、机まわりの片づけ手順を考えて",
] as const;

const runTurn = async (
  options: RunNonAdultLongConversationOptions,
  history: ChatMessage[],
): Promise<{ assistant: string; latencyMs: number; servedModel: string | null }> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const headers: Record<string, string> = {
    "CF-Access-Authenticated-User-Email": options.email,
    "Content-Type": "application/json",
  };
  if (options.basicAuthUser && options.basicAuthPass) {
    const credentials = Buffer.from(
      `${options.basicAuthUser}:${options.basicAuthPass}`,
      "utf8",
    ).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  } else if (options.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: history,
      characterId: options.characterId ?? "char-saya",
      scenePhase: "conversation",
      model: getDefaultModelForPhase("conversation"),
      responseLength: "medium",
    }),
  });

  if (!response.ok) {
    throw new Error(`chat API returned HTTP ${response.status}`);
  }

  const parsed = parseChatSseBody(await response.text());
  // 中継開始後の失敗は HTTP 200 で届く。本文が残っていても打ち切られた途中経過。
  const failure = describeChatSseFailure(parsed);
  if (failure) {
    throw new Error(`chat stream did not complete (${failure})`);
  }
  if (!parsed.text.trim()) {
    throw new Error("chat API returned an empty assistant response");
  }

  return {
    assistant: parsed.text,
    latencyMs: now() - startedAt,
    servedModel: parsed.servedModel,
  };
};

export const runNonAdultLongConversation = async (
  options: RunNonAdultLongConversationOptions,
): Promise<NonAdultLongConversationResult> => {
  const history: ChatMessage[] = [];
  const evaluationTurns: Array<{ assistant: string; latencyMs: number }> = [];
  const turnEvidence: NonAdultLongConversationTurn[] = [];

  for (const [index, userInput] of NON_ADULT_LONG_CONVERSATION_INPUTS.entries()) {
    history.push({ role: "user", content: userInput });
    const result = await runTurn(options, history);
    history.push({ role: "assistant", content: result.assistant });
    evaluationTurns.push({ assistant: result.assistant, latencyMs: result.latencyMs });
    const evidence = {
      turn: index + 1,
      latencyMs: result.latencyMs,
      assistantChars: result.assistant.length,
      servedModel: result.servedModel,
    };
    turnEvidence.push(evidence);
    options.onTurn?.(evidence);
  }

  const overall = evaluateLongConversation(evaluationTurns);
  const lateTurnEvaluation = evaluateLongConversation(evaluationTurns.slice(21));
  const repeatedTurnIndexes = overall.repeatedTurnIndexes.filter((turn) => turn >= 22);
  const lateTurnP95LatencyMs = lateTurnEvaluation.p95LatencyMs;
  const passed = repeatedTurnIndexes.length === 0 && lateTurnP95LatencyMs < 45_000;

  return {
    scenarioId: "nonadult-daily-conversation-v1",
    phase: "conversation",
    turnCount: overall.turnCount,
    apiErrorCount: 0,
    repetitionLoopOccurrences: overall.repetitionLoopOccurrences,
    repeatedTurnIndexes: overall.repeatedTurnIndexes,
    p95LatencyMs: overall.p95LatencyMs,
    lateTurn: {
      startTurn: 22,
      turnCount: lateTurnEvaluation.turnCount,
      repetitionLoopOccurrences: repeatedTurnIndexes.length,
      repeatedTurnIndexes,
      p95LatencyMs: lateTurnP95LatencyMs,
    },
    thresholds: {
      maxLateTurnRepetitionLoopOccurrences: 0,
      maxLateTurnP95LatencyMs: 45_000,
    },
    passed,
    turns: turnEvidence,
  };
};
