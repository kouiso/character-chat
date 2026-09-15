// /api/image の失敗は logger にしか出ておらず、UI 側は placeholder が静かに消えるだけだった。
// 身元アンカー空を 422 で止めるようにした結果、「押しても何も起きんボタン」に見える経路が
// 決定的に発生しうるため、原因と次の一手が分かる日本語へ落として toast に出す。
export const IMAGE_IDENTITY_MISSING_CODE = "character_identity_missing";

const IDENTITY_MISSING_MESSAGE =
  "キャラの見た目が未設定のため画像を生成できません。キャラ編集で髪・目・体型などを設定してください";
const RATE_LIMIT_MESSAGE = "画像生成が混雑しています。しばらく待ってから試してください";
const GENERIC_FAILURE_MESSAGE = "画像の生成に失敗しました。少し時間をおいて試してください";

// サーバーは 422 の本文を JSON で返し、クライアントは response.text() をそのまま error に詰める。
// よって JSON 文字列とプレーンなコードのどちらでも判別できるよう部分一致で見る。
// ポーリングは例外で失敗が伝わるため Error もそのまま受け取れるようにする。
// 画像は生成できて画面にも出ており、保存だけが失敗した状態。再生成を促すと枠を二重に使うので、
// 「もう一度試して」とは言わん。
const PERSIST_FAILURE_MESSAGE =
  "画像は表示できましたが、保存に失敗しました。アルバムに残らない場合があります";

// 内部レート制限、Novita からの 429、または "Too Many Requests" のレスポンス本文を判別する。
const isRateLimitedError = (text: string): boolean => {
  if (text.includes("429")) return true;
  if (text.toLowerCase().includes("too many requests")) return true;
  if (text.includes("rate_limited") || text.includes("rate_limit_exceeded")) return true;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const upstream = parsed.upstream as Record<string, unknown> | undefined;
    if (upstream?.status === 429 || upstream?.status === "429") return true;
  } catch {
    // JSON じゃないなら部分一致のみで判定する
  }
  return false;
};

export const describeImagePersistError = (): string => PERSIST_FAILURE_MESSAGE;

export const describeImageGenerationError = (raw: unknown): string => {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw);
  if (text.includes(IMAGE_IDENTITY_MISSING_CODE)) return IDENTITY_MISSING_MESSAGE;
  if (isRateLimitedError(text)) return RATE_LIMIT_MESSAGE;
  return GENERIC_FAILURE_MESSAGE;
};
