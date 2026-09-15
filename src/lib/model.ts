// OpenRouter 経由のチャット生成用デフォルトモデル。
export const DEFAULT_CHAT_MODEL = "qwen/qwen-2.5-72b-instruct" as const;
export const EROTIC_CHAT_MODEL = "deepseek/deepseek-chat" as const;
// 6/20 eval で erotic 品質最強と確定した RP 特化モデル。7/9 に「合計生成時間が遅い」
// だけを理由に外され品質27点まで退行したため、7/12 の TTFT ベンチ
// (.work/bench/ttft-bench-2026-07-12T09-31-44.md: TTFT p50=2968ms / 25.5c/s、両SLO達成)
// を根拠に erotic/climax プライマリへ復帰。
export const EURYALE_CHAT_MODEL = "sao10k/l3.3-euryale-70b" as const;
export const LLM_ROUTER_MODEL = "qwen/qwen-2.5-72b-instruct" as const;

export const NSFW_CHAT_MODEL_RECOMMENDATION = {
  primaryModel: EURYALE_CHAT_MODEL,
  backupModels: [EROTIC_CHAT_MODEL, DEFAULT_CHAT_MODEL] as const,
  providerPath:
    "Euryale primary for erotic/climax with DeepSeek/Qwen fallback chain; avoid Magnum because availability is unstable.",
  reviewedAt: "2026-07-12",
  reason:
    "Euryale 70B won the 2026-06-20 quality eval for explicit roleplay; 2026-07-12 TTFT bench confirmed it meets streaming SLOs (TTFT p50 2968ms, 25.5 chars/s).",
} as const;

export const DEFAULT_CHAT_MODEL_FALLBACKS = [EROTIC_CHAT_MODEL, EURYALE_CHAT_MODEL] as const;

export const MODEL_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  [DEFAULT_CHAT_MODEL]: DEFAULT_CHAT_MODEL_FALLBACKS,
  "deepseek/deepseek-chat": ["qwen/qwen-2.5-72b-instruct"],
  "sao10k/l3.3-euryale-70b": [EROTIC_CHAT_MODEL, DEFAULT_CHAT_MODEL],
  "anthracite-org/magnum-v4-72b": [EROTIC_CHAT_MODEL, DEFAULT_CHAT_MODEL],
  "deepseek/deepseek-chat-v3-0324": [],
};

export const DEFAULT_FALLBACK_MODELS = [...DEFAULT_CHAT_MODEL_FALLBACKS] as const;

export type PhaseRoutableScenePhase =
  | "conversation"
  | "intimate"
  | "erotic"
  | "climax"
  | "afterglow";

export const getDefaultModelForPhase = (
  phase: PhaseRoutableScenePhase,
): typeof DEFAULT_CHAT_MODEL | typeof EROTIC_CHAT_MODEL | typeof EURYALE_CHAT_MODEL => {
  switch (phase) {
    case "erotic":
    case "climax":
      // 7/9 の deepseek/qwen 退避は「合計生成時間」だけを判断材料にしており、
      // 品質(6/20 eval最強→7/8実測27点)を犠牲にしていた。7/12 TTFTベンチで
      // euryale は TTFT p50=2968ms・25.5文字/秒と両SLO達成を実測。遅延テール
      // (upstream 429・max TTFT 36.9s)は firstTokenTimeout + MODEL_FALLBACKS の
      // deepseek/qwen 退避連鎖が受け止める。
      return EURYALE_CHAT_MODEL;
    case "conversation":
    case "intimate":
    case "afterglow":
      return DEFAULT_CHAT_MODEL;
  }
};

export const resolvePhaseRoutedChatModel = (
  requestedModel: string,
  phase: PhaseRoutableScenePhase,
): string => {
  if (requestedModel !== DEFAULT_CHAT_MODEL) return requestedModel;
  return getDefaultModelForPhase(phase);
};

export const MODEL_CATALOG = [
  // ── 無料 ────────────────────────────────────────────────────────────────
  {
    id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    name: "Venice Uncensored（無料）",
    tier: "無料",
    desc: "24B・成人向けロールプレイOK",
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    name: "Hermes 3 405B（無料）",
    tier: "無料",
    desc: "405B・高品質・アンセンサード",
  },
  // ── スタンダード ─────────────────────────────────────────────────────────
  {
    id: "thedrummer/unslopnemo-12b",
    name: "UnslopNemo 12B",
    tier: "スタンダード",
    desc: "RP特化・アダルトOK",
  },
  {
    id: "gryphe/mythomax-l2-13b",
    name: "MythoMax 13B",
    tier: "スタンダード",
    desc: "クラシックRP向け・アダルトOK",
  },
  {
    id: "undi95/toppy-m-7b",
    name: "Toppy M 7B",
    tier: "スタンダード",
    desc: "軽量・高速・アンセンサード",
  },
  // ── プレミアム ───────────────────────────────────────────────────────────
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    tier: "プレミアム",
    desc: "長文・低単価の代替候補。Qwen失敗時の退避先",
  },
  {
    id: "sao10k/l3.3-euryale-70b",
    name: "Euryale v3 70B",
    tier: "プレミアム",
    desc: "最新Euryale・RP/アダルト最高品質",
  },
  {
    id: "sao10k/l3.1-euryale-70b",
    name: "Euryale v2 70B",
    tier: "プレミアム",
    desc: "RP特化fine-tune・安定高品質",
  },
  {
    id: "sao10k/l3-euryale-70b",
    name: "Euryale v1 70B",
    tier: "プレミアム",
    desc: "Euryale旧版・実績あり",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen 2.5 72B Instruct ⭐ 日本語安定",
    tier: "プレミアム",
    desc: "通常会話と成人向け山場の既定。日本語・指示追従が安定",
  },
  {
    id: "anthracite-org/magnum-v4-72b",
    name: "Magnum v4 72B",
    tier: "プレミアム",
    desc: "成人向けロールプレイの主推奨。官能描写・会話の崩れにくさを優先",
  },
  {
    id: "qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    tier: "プレミアム",
    desc: "既定 qwen-2.5-72b の後継世代。2026-08-19 に比較測定のため追加（本命判定は測定後）",
  },
  {
    id: "x-ai/grok-4.6",
    name: "Grok 4.6",
    tier: "プレミアム",
    desc: "成人向けの許容度が広い候補。2026-08-19 に比較測定のため追加（本命判定は測定後）",
  },
  {
    id: "nousresearch/hermes-4-70b",
    name: "Hermes 4 70B",
    tier: "プレミアム",
    desc: "最新Hermes・汎用高品質",
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-70b",
    name: "Hermes 3 70B",
    tier: "プレミアム",
    desc: "アンセンサード・汎用",
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    name: "DeepSeek V3-0324 ⚠️ 拒否負例",
    tier: "プレミアム",
    desc: "拒否検出検証専用。本番使用禁止（620854dでrevert済み）",
  },
] as const;

// z.enum()が要求する非空タプル型をas無しで導出する
type ModelId = (typeof MODEL_CATALOG)[number]["id"];

const extractModelIds = <T extends readonly { id: string }[]>(
  catalog: T,
): [T[0]["id"], ...T[number]["id"][]] => {
  const [first, ...rest] = catalog.map((m) => m.id);
  return [first, ...rest];
};

export const ALLOWED_MODELS: readonly [ModelId, ...ModelId[]] = extractModelIds(MODEL_CATALOG);

export type AllowedModel = ModelId;
