export type RequestFailure = { url: string; detail: string };

export type Verdict = "verified" | "needs_work" | "channel_failure";

// 非公式キャラのアバターは /api/avatar/:key が認証を要求する設計
// (functions/api/[[route]].ts の「プライベートアバター: 認証必須」)。
// 匿名でページを開くこのスモークでは、その分岐は必ず 401 を返す。仕様どおりなので不合格にせん。
// 404 は除外せん。公式キャラのアバターは匿名でも配信され、R2 実体が無い時だけ 404 になる。
// これは実際の欠損なので不合格に効かせる（2026-07-26 codex 指摘）。
export const isExpectedAnonymousAvatarDenial = (url: string, status: number): boolean =>
  url.includes("/api/avatar/") && status === 401;

// 起動時の auth_token 更新は失敗しても credentials UI へ委ねる補助経路。
// ローカル worker に AUTH_SIGNING_KEY が無い時だけ返る 503 は画面描画を妨げん。
export const isExpectedAuthBootstrapFailure = (url: string, status: number): boolean => {
  if (status !== 503) return false;
  try {
    return new URL(url, "http://localhost").pathname === "/api/auth/session";
  } catch {
    return false;
  }
};

// リソース読み込み失敗のブラウザ既定メッセージは URL を含まんため、
// これ単体では上の判定ができん。実体は response イベント側で URL つきで拾うので、
// ここで拾うと同じ失敗を二重計上した上に除外もでけへんようになる。
export const isResourceLoadConsoleNoise = (text: string): boolean =>
  text.startsWith("Failed to load resource:");

export const isBackendRequest = (url: string): boolean => url.includes("/api/");

/**
 * バックエンド不在による失敗と、UI の欠陥による失敗を分ける。
 *
 * `pnpm verify:visual` は Vite だけを起動する。Vite は /api を 8788 の worker へ
 * 転送するが、worker は別コマンド (`pnpm dev:worker`) でしか起動しない。
 * つまり worker を上げていない環境では /api の要求が必ず失敗する。
 * これを UI の欠陥として needs_work にすると、単独で走らせた時に絶対に通らん。
 * 判定できる材料が無い状態なので channel_failure として扱う。
 */
export const partitionRequestFailures = (
  failures: readonly RequestFailure[],
  backendReachable: boolean,
): { uiDefects: RequestFailure[]; backendUnavailable: RequestFailure[] } => {
  if (backendReachable) return { uiDefects: [...failures], backendUnavailable: [] };

  const uiDefects: RequestFailure[] = [];
  const backendUnavailable: RequestFailure[] = [];
  for (const failure of failures) {
    if (isBackendRequest(failure.url)) backendUnavailable.push(failure);
    else uiDefects.push(failure);
  }
  return { uiDefects, backendUnavailable };
};

export const resolveVerdict = (input: {
  pageErrors: readonly string[];
  uiDefects: readonly RequestFailure[];
  backendUnavailable: readonly RequestFailure[];
  screenshotExists: boolean;
}): Verdict => {
  // バックエンドが居ない時点で UI の合否は測れん。UI の欠陥より先に判定する。
  if (input.backendUnavailable.length > 0) return "channel_failure";
  if (input.pageErrors.length > 0 || input.uiDefects.length > 0) return "needs_work";
  if (!input.screenshotExists) return "channel_failure";
  return "verified";
};
