import type { ChatMessage } from "@/store/chat-store";

/**
 * 返事待ちが明けた時に、自動で送り直す 1 件を選ぶ。
 *
 * 元は「オフラインで積んだもの（offlineQueued）」だけが対象やった。局長の報告
 * （2026-08-19「他のアプリに移動すると失敗します」「押しても再送信しない」）は
 * どちらもこの穴に落ちる——
 *   ・背面へ回った時にブラウザが止めた送信は、オンラインのまま失敗するので拾われん
 *   ・別の生成が走っとる最中に「タップで再送」を押すと、その場では送れん
 * 待てば送れるのに、待つ役が居らんかった。押した意思を retryRequested として残して、
 * 同じ機構に拾わせる。
 */
export const pickAutoRetryTarget = (messages: ChatMessage[]): ChatMessage | undefined =>
  messages.find(
    (message) => message.role === "user" && (message.offlineQueued || message.retryRequested),
  );
