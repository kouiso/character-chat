// 1 ターン分（自分の発言＋返信）を D1 へ保存する時の状態遷移。
// React に依存しない純ロジックとして切り出し、部分永続の分岐をテストで固定する。
//
// 原則: 「分からない」を成功として閉じない。そして、失敗の見た目から在否を推測しない。
//
// 中断・タイムアウト・接続断が「保存されなかった」を意味しないのは当然として、
// 応答が返ってきた失敗（500）も「保存されなかった」を意味しない。エンドポイントは
// messages を INSERT した後に memory_note の書き込みと会話の updatedAt 更新を
// 同じ try の中で続けており、後段が落ちても 500 を返す
// （functions/api/[[route]].ts の POST /conversations/:id/messages）。
// つまり 500 は「行が入っていない」の証拠にならない。そこで、
//   - 失敗の種類に関わらず、必ず読み直して在否を確定させる
//   - 無いと確定したら同じ id で入れ直す（id が同じなので二重化しない）
//   - それでも確定できない時は、画面を D1 の中身へ揃えて食い違いを残さない
// とする。確定できないまま返信だけを書くと user 行の無い返信が残り、確定できないまま
// 成功として閉じると再読込で返信が消える。どちらも「送れたように見えて消える」形になる。
// 逆に 500 を「無い」と決め打つと、在る行を消す（ロールバック）か、再送で二重にする。

export type PersistPresence = "present" | "absent" | "unknown";

export type PersistTurnDeps = {
  /** 行を1件 INSERT する。id は呼び出し側が決める（再投入で二重化させないため）。 */
  createRow: (kind: "user" | "assistant") => Promise<void>;
  /** その id が D1 に在るかを読み直す。読み取り自体が失敗したら "unknown"。 */
  confirmPersisted: (kind: "user" | "assistant") => Promise<PersistPresence>;
  /** user 行を消す。失敗したら throw。 */
  deleteUserRow: () => Promise<void>;
  /** 画面を D1 の中身へ揃える。揃えられたら true、読み直せんかったら false。 */
  resyncFromPersisted: () => Promise<boolean>;
  /** 返信の吹き出しを画面から消す。 */
  removeAssistantBubble: () => void;
  /** 自分の発言を未送達（再送可能）に戻す。 */
  markUserRetryable: () => void;
  logError: (message: string, error: unknown) => void;
};

export type PersistTurnOutcome =
  | "persisted"
  | "user_retryable"
  | "resynced"
  | "assistant_reinserted"
  // 保存が確定できず、画面を D1 へ揃えることもできんかった。画面と D1 の食い違いが
  // 残ったままなので、成功と同じ顔で閉じたらあかん（呼び出し側が利用者へ知らせる）。
  | "unreconciled";

// 揃え直しの成否をそのまま結果へ出す。resync が失敗しとるのに "resynced" を返すと、
// 画面は完了したターンに見えるのに D1 はそれを持ってへん、という食い違いが黙って残る。
const reconcile = async (deps: PersistTurnDeps): Promise<PersistTurnOutcome> =>
  (await deps.resyncFromPersisted()) ? "resynced" : "unreconciled";

// 入れ直しは1回だけ。absent を読んだ直後の入れ直しがまた absent なら、行が入らない
// 理由は一過性やない（会話が無い・権限が無い・スキーマが合わない）。粘っても同じで、
// 送信ロックの解除だけが遠のく。
const MAX_CREATE_ATTEMPTS = 2;

/**
 * 行を1件書き、書けたことを確定させる。
 *
 * 失敗したら種類を問わず読み直す。500 も「入っていない」の証拠にならないため
 * （モジュール冒頭の理由）、在否はサーバへ聞く以外に決めようがない。
 *   - present: 入っとる。入れ直さない（入れ直したら二重になる）
 *   - absent : 入っていないと確定。同じ id で入れ直す。それでも absent なら throw
 *   - unknown: 読み直せんかった。確定した失敗へ格下げも格上げもせず、そのまま返す
 *              （呼び出し側が画面を D1 へ揃える側へ回す）
 *
 * absent の後の入れ直しが失敗しても、その失敗自体では確定できひんことに注意する。
 * 最初の POST がクライアント側のタイムアウトを跨いでサーバで生き残っとると、absent を
 * 読んだ後にその INSERT が着地し、入れ直しが同じ id の衝突として 500 に化ける。
 * なので毎回の失敗の後に読み直す形にしてある。
 */
const ensureRow = async (
  deps: PersistTurnDeps,
  kind: "user" | "assistant",
): Promise<"present" | "unknown"> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await deps.createRow(kind);
      return "present";
    } catch (error) {
      deps.logError(
        attempt === 1 ? `${kind} row persist failed` : `${kind} row reinsert failed`,
        error,
      );
      const seen = await deps.confirmPersisted(kind);
      if (seen === "present") return "present";
      if (seen === "unknown") return "unknown";
      if (attempt >= MAX_CREATE_ATTEMPTS) throw error;
    }
  }
};

// ensureRow が "unknown" を返した後の後始末。reconcile を素通りさせるだけでは
// 2つの穴が残る（レビュー指摘）。
//
// 穴1: unknown のまま resync すると、まだ markUserRetryable していない自分の発言は
// sendFailed が立ってへんので、resyncFromPersisted の queued 判定（sendFailed のものだけ
// 残す）から漏れる。D1 に実際に無ければ、screen 上からその発言ごと消える
// （再送不能なまま入力が失われる）。
// 穴2: unknown は「無い」の確定やない。実は入っとる場合、resync は screen を
// D1 の中身へ揃えるだけで終わり、返信を一度も書かないまま止まる
// （自分の発言は確定しとるのに応答が永遠に来ない）。
//
// どちらも「入っとるかどうかをもう一度確かめる」ことでしか閉じない。ensureRow の
// 入れ直しは1回きりだが、確認自体をもう一度だけ重ねるのは安全（書き込みを伴わない）。
const resolveUnknownPresence = async (
  deps: PersistTurnDeps,
  kind: "user" | "assistant",
): Promise<"present" | "absent" | "still-unknown"> => {
  const presence = await deps.confirmPersisted(kind);
  if (presence === "present" || presence === "absent") return presence;
  return "still-unknown";
};

// 自分の発言が確定して無いと分かった時の後始末。markUserRetryable を resync より
// 先に呼ぶ。順序を逆にすると、まだ sendFailed が立ってへんこの発言が resync の
// queued 判定(sendFailed 済みのものだけ残す)から漏れて、screen から消える。
const handleUserAbsent = async (deps: PersistTurnDeps): Promise<PersistTurnOutcome> => {
  deps.removeAssistantBubble();
  deps.markUserRetryable();
  await deps.resyncFromPersisted();
  return "user_retryable";
};

// 返信が確定して無いと分かった時の後始末。ensureRow が投げて絶対失敗が確定した時と、
// unknown を確認し直して absent と判った時の両方から呼ぶ(処理は同じ)。
const rollbackAfterAssistantAbsent = async (deps: PersistTurnDeps): Promise<PersistTurnOutcome> => {
  try {
    await deps.deleteUserRow();
  } catch (rollbackError) {
    deps.logError("user row rollback failed", rollbackError);
    // 取り消しが確定していないので未送達へは戻さない（戻すと再送で user 行が増える）。
    // ただし返信が D1 に無いことは確定しているため、成功には見せない。
    return reconcile(deps);
  }
  deps.removeAssistantBubble();
  deps.markUserRetryable();
  return "user_retryable";
};

export const persistTurn = async (deps: PersistTurnDeps): Promise<PersistTurnOutcome> => {
  // ①自分の発言。
  let userPresence: "present" | "unknown";
  try {
    userPresence = await ensureRow(deps, "user");
  } catch {
    // 読み直して absent と確定した＝入っていない。未送達へ戻して再送可能にする。
    deps.removeAssistantBubble();
    deps.markUserRetryable();
    return "user_retryable";
  }
  if (userPresence === "unknown") {
    const resolved = await resolveUnknownPresence(deps, "user");
    // 在るとも無いとも決まらない。screen を D1 へ揃えることしかできひん。
    if (resolved === "still-unknown") return reconcile(deps);
    if (resolved === "absent") return handleUserAbsent(deps);
    // present: 実は入っとった。②へそのまま続ける。
  }

  // ②返信。
  let assistantPresence: "present" | "unknown";
  try {
    assistantPresence = await ensureRow(deps, "assistant");
  } catch {
    // 読み直して absent と確定した＝返信は入っていない。自分の発言だけが残るので取り消す。
    return rollbackAfterAssistantAbsent(deps);
  }
  if (assistantPresence === "unknown") {
    const resolved = await resolveUnknownPresence(deps, "assistant");
    if (resolved === "present") return "persisted";
    if (resolved === "still-unknown") return reconcile(deps);
    return rollbackAfterAssistantAbsent(deps);
  }
  return "persisted";
};
