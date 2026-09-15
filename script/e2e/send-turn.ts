// ターン送信の中核。Playwright に依存しない純ロジックとして切り出し、
// 「送信できたか」を DOM の反映で必ず確認してから次へ進めるようにする。
//
// 背景 (#993): 旧実装は「送信ボタンが enabled か」を 2 秒間隔でポーリングし、
// 別ステップで click({ force: true }) していた。force はアクションビリティ検査を
// 迂回するため、ポーリングと click の隙間で isLoading が true に戻ると
// クリックは発火するが handleSend が即 return し、user message が DOM に入らない。
// さらに各内側の待ちがターン全体と同じ 300 秒予算を使っていたため、
// 外側の withTimeout が先に発火して原因が "turn-N-send timed out" に潰れていた。
//
// 対策は 3 点:
//   1. disabled 判定と click を同一の同期タスクで行う（隙間を消す）
//   2. 送信後に user message が DOM に入ったことを確認し、入らなければ再送する
//   3. 各段階に固有の短い予算と固有の失敗コードを与え、原因が残る形で速く落とす

export type ComposerState = {
  textareaFound: boolean;
  /** textarea の disabled は ou-app.tsx の isLoading に直結する（input-bar.tsx）。 */
  textareaDisabled: boolean;
  textareaLength: number;
  buttonFound: boolean;
  buttonDisabled: boolean;
  renderedMessageCount: number;
};

export type SendTurnFailureCode =
  | "composer_locked"
  // textarea がそもそも生えてこない。isLoading の滞留ではなく、画面が描画されて
  // いない（遷移失敗・クラッシュ・別画面のまま）。composer_locked と同じ扱いにすると
  // アプリ側のストリーム滞留として集計され、原因が別物に化ける。
  | "composer_missing"
  | "fill_failed"
  | "send_button_never_enabled"
  | "send_click_no_effect";

export type SendTurnBudget = {
  composerUnlockFirstMs: number;
  composerUnlockRetryMs: number;
  fillMs: number;
  buttonEnableMs: number;
  echoMs: number;
  pollMs: number;
  attempts: number;
};

// 1 回目の解除待ちだけ長いのは、直前ターンの永続化がまだ走っている可能性があるため。
// 2 回目以降は既に一度解除を見ているので、粘っても状況は変わらない。
// echoMs が広いのは、初回ターンだけ ensureConversation の往復が挟まるため。
export const DEFAULT_SEND_TURN_BUDGET: SendTurnBudget = {
  composerUnlockFirstMs: 45_000,
  composerUnlockRetryMs: 10_000,
  fillMs: 30_000,
  buttonEnableMs: 5_000,
  echoMs: 15_000,
  pollMs: 500,
  attempts: 3,
};

/**
 * 内側の待ちを全部使い切った場合の総和。呼び出し側の withTimeout をこれより短く
 * すると、外側が先に発火して固有の失敗コードが "timed out" に潰れる（#993 の再来）。
 */
export const computeSendPhaseTimeoutMs = (
  budget: SendTurnBudget = DEFAULT_SEND_TURN_BUDGET,
  marginMs = 15_000,
): number => {
  const perAttempt = budget.fillMs + budget.buttonEnableMs + budget.echoMs;
  const unlockTotal =
    budget.composerUnlockFirstMs + budget.composerUnlockRetryMs * Math.max(0, budget.attempts - 1);
  return unlockTotal + perAttempt * budget.attempts + marginMs;
};

/**
 * 残り時間が送信フェーズの総和より短いときに、内側の予算を縮めて収める。
 *
 * シナリオ終盤は turnTimeoutMs より残り時間が短くなる。そこで外側の上限だけを
 * Math.min で切ると、内側の待ちが終わる前に外側が発火して、composer_locked や
 * composer_missing といった固有コードが "turn-N-send timed out" に潰れる（#993 の本体）。
 * 潰れると、composer が開かなかったのか画面が出ていなかったのかが結果から消える。
 *
 * 予算は総和に対して線形なので、全体を同じ比率で縮めれば「内側の総和 < 外側の上限」
 * という関係はそのまま保たれる。余白ぶん（marginMs * factor）が必ず残るため、
 * 内側は外側より先に必ず落ちて、自分のコードを出せる。
 * attempts は縮めない。回数を削ると「1 回目は空振りしたが 2 回目で通る」形が
 * 取れなくなり、時間ではなく判定そのものが変わってしまう。
 */
export const fitSendPhaseToRemaining = (
  availableMs: number,
  budget: SendTurnBudget = DEFAULT_SEND_TURN_BUDGET,
  marginMs = 15_000,
): { budget: SendTurnBudget; timeoutMs: number; factor: number } => {
  const full = computeSendPhaseTimeoutMs(budget, marginMs);
  if (availableMs >= full) return { budget, timeoutMs: full, factor: 1 };

  const factor = Math.max(0, availableMs) / full;
  // 0 秒の待ちは「待たずに即失敗」になり、瞬間的な滞留まで失敗として出る。最低 1ms は残す。
  const scale = (ms: number): number => Math.max(1, Math.floor(ms * factor));
  return {
    budget: {
      composerUnlockFirstMs: scale(budget.composerUnlockFirstMs),
      composerUnlockRetryMs: scale(budget.composerUnlockRetryMs),
      fillMs: scale(budget.fillMs),
      buttonEnableMs: scale(budget.buttonEnableMs),
      echoMs: scale(budget.echoMs),
      // ポーリング間隔も縮める。据え置くと、縮んだ待ちに対して間隔が粗すぎて
      // 各待ちが最大 1 回ぶん超過し、超過の合計が外側の上限を追い越す。
      pollMs: scale(budget.pollMs),
      attempts: budget.attempts,
    },
    timeoutMs: Math.max(0, availableMs),
    factor,
  };
};

export type SendClickResult = {
  clicked: boolean;
  /** click を試みた瞬間(同一タスク内)の描画数。呼び出し側が期待値を組む基準。 */
  renderedMessageCount: number;
};

export type SendTurnDeps = {
  readComposerState: () => Promise<ComposerState>;
  dismissPhotoOverlay: () => Promise<void>;
  fillInput: (text: string) => Promise<void>;
  // disabled 判定・当たり判定・click・click 直前の描画数読みを同一タスクで行わせる境界。
  // 分けると、その隙間で isLoading が戻ったり(#993)、無関係な描画が挟まって(#997) 誤判定する。
  clickSendIfEnabled: () => Promise<SendClickResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type SendTurnOutcome = {
  attempts: number;
  // waitForStreamComplete がこのターンの要求だけを見るための基準時刻。
  sendIssuedAt: number;
  // click 直前に観測した描画数。呼び出し側が期待値を組み直すのに使う。
  // 入場時の baseline は、前ターンの永続化ロールバックで吹き出しが
  // 減っていると古くなる。
  renderedBeforeSend: number;
  state: ComposerState;
};

export const describeComposerState = (state: ComposerState): string => {
  const textarea = state.textareaFound
    ? state.textareaDisabled
      ? "disabled"
      : "enabled"
    : "missing";
  const button = state.buttonFound ? (state.buttonDisabled ? "disabled" : "enabled") : "missing";
  return `composer{textarea=${textarea},textLen=${state.textareaLength},sendButton=${button},rendered=${state.renderedMessageCount}}`;
};

export class SendTurnError extends Error {
  readonly code: SendTurnFailureCode;
  readonly state: ComposerState;
  readonly attempts: number;

  constructor(params: {
    turnIndex: number;
    code: SendTurnFailureCode;
    state: ComposerState;
    attempts: number;
  }) {
    // "timed out" を含めない。scenario-runner が terminationReason を
    // turn_timeout へ丸めてしまい、原因が消えるため。
    super(
      `turn-${params.turnIndex}-send blocked: ${params.code} after ${params.attempts} attempt(s) ${describeComposerState(params.state)}`,
    );
    this.name = "SendTurnError";
    this.code = params.code;
    this.state = params.state;
    this.attempts = params.attempts;
  }
}

const waitForComposer = async (
  deps: SendTurnDeps,
  predicate: (state: ComposerState) => boolean,
  timeoutMs: number,
  pollMs: number,
): Promise<{ ok: boolean; state: ComposerState }> => {
  const deadline = deps.now() + timeoutMs;
  let state = await deps.readComposerState();
  for (;;) {
    if (predicate(state)) return { ok: true, state };
    if (deps.now() >= deadline) return { ok: false, state };
    await deps.sleep(pollMs);
    await deps.dismissPhotoOverlay();
    state = await deps.readComposerState();
  }
};

const fillWithOverlayRetry = async (
  deps: SendTurnDeps,
  text: string,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> => {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    try {
      await deps.fillInput(text);
      return true;
    } catch {
      // 生成画像の到着でフルスクリーンビューアが composer を覆うことがある。閉じて再試行する。
      await deps.dismissPhotoOverlay();
    }
    if (deps.now() >= deadline) return false;
    await deps.sleep(pollMs);
  }
};

/**
 * 1 ターン分のメッセージを送信し、user message が DOM に入ったことまで確認する。
 * 確認できない場合は再送し、上限に達したら固有の失敗コードで throw する。
 */
export const sendTurnMessage = async (
  deps: SendTurnDeps,
  params: {
    turnIndex: number;
    text: string;
    baselineMessageCount: number;
    budget?: Partial<SendTurnBudget>;
  },
): Promise<SendTurnOutcome> => {
  const budget = { ...DEFAULT_SEND_TURN_BUDGET, ...params.budget };
  let state = await deps.readComposerState();
  let lastCode: SendTurnFailureCode = "composer_locked";
  // 返す時刻は「このターンで最初に click した時刻」に固定する。再送した場合、
  // 実際にサーバへ届いたのが何回目の click かは分からない。後の click の時刻を返すと、
  // 受理された要求の lastChatRequestAt がそれより前になり、waitForStreamComplete が
  // 自分のターンの要求を弾いてストリーム待ちを使い切る。
  let sendIssuedAt = deps.now();
  let sendIssuedAtPinned = false;
  const pinSendIssuedAt = (at: number): void => {
    if (sendIssuedAtPinned) return;
    sendIssuedAt = at;
    sendIssuedAtPinned = true;
  };
  let renderedBeforeSend = params.baselineMessageCount;

  // このターンの発言が描画されたか。基準は click 直前に観測した数（renderedBeforeSend）で、
  // 入場時の baseline やない。
  //
  // 理由は 2 つある。まず、自分がまだ一度も click していない間の増加は、このターンの
  // 発言やない（挨拶の描画・建て直し・前ターンの遅れた反映）。それを自分の発言として
  // 受け取ると、台本の発言を送らないまま次へ進む。だから click 済みの時だけ拾う。
  // さらに、入場時の baseline は前ターンの吹き出しが 1 件遅れて描画されただけで古くなる。
  // 古い baseline を基準にすると、1 回目の click が空振りしても既に baseline+1 に
  // 達しているため、次の周回の頭で「増えた」と読んで成功で返る。自分は 1 件も
  // 足していないのに成功する（#993 の「送られてへんのに通る」と同じ形）。
  const hasThisTurnEcho = (observed: ComposerState): boolean =>
    sendIssuedAtPinned && observed.renderedMessageCount >= renderedBeforeSend + 1;

  for (let attempt = 1; attempt <= budget.attempts; attempt += 1) {
    await deps.dismissPhotoOverlay();
    state = await deps.readComposerState();

    if (hasThisTurnEcho(state)) {
      return { attempts: attempt, sendIssuedAt, renderedBeforeSend, state };
    }

    const unlockMs = attempt === 1 ? budget.composerUnlockFirstMs : budget.composerUnlockRetryMs;
    const unlocked = await waitForComposer(
      deps,
      (s) => s.textareaFound && !s.textareaDisabled,
      unlockMs,
      budget.pollMs,
    );
    state = unlocked.state;
    // 待っている間に自分の click の反映が届くことがある。ここで拾わないと、
    // 届いたのに二重送信する（unlocked）か、届いたのに失敗扱いで落とす（!unlocked）。
    if (hasThisTurnEcho(state)) {
      return { attempts: attempt, sendIssuedAt, renderedBeforeSend, state };
    }
    if (!unlocked.ok) {
      // 待ち切れなかった理由は 2 通りある。textarea が在って disabled のままなら
      // isLoading が下りていない（アプリ側の滞留）。そもそも textarea が無いなら
      // 画面が描画されていない（遷移・描画の失敗）。同じコードで出すと後者が
      // ストリーム滞留として集計され、原因が消える。
      lastCode = state.textareaFound ? "composer_locked" : "composer_missing";
      continue;
    }

    const filled = await fillWithOverlayRetry(deps, params.text, budget.fillMs, budget.pollMs);
    if (!filled) {
      state = await deps.readComposerState();
      lastCode = "fill_failed";
      continue;
    }

    const enabled = await waitForComposer(
      deps,
      (s) => s.buttonFound && !s.buttonDisabled,
      budget.buttonEnableMs,
      budget.pollMs,
    );
    state = enabled.state;
    if (!enabled.ok) {
      lastCode = "send_button_never_enabled";
      continue;
    }

    // 期待値は click と同じタスクで読んだ数から組む(#997 再指摘)。別の page.evaluate で
    // 読み直すと、その隙間に挨拶や前ターンの遅延描画が割り込んで数が増えることがあり、
    // click が不発でもその無関係な増分だけで「送れた」と echo 判定が誤って成立する。
    const issuedAt = deps.now();
    const clickResult = await deps.clickSendIfEnabled();
    if (!clickResult.clicked) {
      // click が発火してへんので、この時刻は「送った時刻」やない。固定せずに捨てる。
      state = await deps.readComposerState();
      lastCode = "send_button_never_enabled";
      continue;
    }
    renderedBeforeSend = clickResult.renderedMessageCount;
    pinSendIssuedAt(issuedAt);

    const echoed = await waitForComposer(
      deps,
      (s) => s.renderedMessageCount >= renderedBeforeSend + 1,
      budget.echoMs,
      budget.pollMs,
    );
    state = echoed.state;
    if (echoed.ok) {
      return { attempts: attempt, sendIssuedAt, renderedBeforeSend, state };
    }
    // click は発火したのに DOM が増えない = handleSend が isLoading で即 return した。
    lastCode = "send_click_no_effect";
  }

  throw new SendTurnError({
    turnIndex: params.turnIndex,
    code: lastCode,
    state,
    attempts: budget.attempts,
  });
};
