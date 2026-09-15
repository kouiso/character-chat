import { useState } from "react";

import { stripXmlTags } from "@/lib/xml-response-parser";
import type { ChatMessage } from "@/store/chat-store";

// 読み上げ文言は画面表示と揃える。別の言い回しにすると、見えとる人と
// 聞いとる人で同じ状態を指す語が食い違う。
const THINKING_LABEL = "ことばを探している";
const IMAGE_GENERATING_LABEL = "画像を生成中";
const IMAGE_ARRIVED_LABEL = "画像が届きました";
const IMAGE_FAILED_LABEL = "画像を用意でけませんでした";

interface AnnouncementState {
  text: string;
  // ストリーミングを見届けた id。これが無いと、履歴を読み込んだだけの
  // 初回描画で過去の返信を喋ってまう。
  streamedId: string | null;
  // 生成中の messageId → 生成を始めた時点の imageUrl。
  // 「今 imageUrl があるか」だけでは、既に画像が付いたメッセージの再生成が
  // 失敗した時に古い画像を新着と誤認する。開始時の値と比べて判定する。
  generating: Record<string, string | null>;
}

interface AnnouncementInput {
  messages: ChatMessage[];
  generatingIds: Set<string>;
}

const INITIAL_STATE: AnnouncementState = { text: "", streamedId: null, generating: {} };

const findImageUrl = (messages: ChatMessage[], id: string): string | null =>
  messages.find((message) => message.id === id)?.imageUrl ?? null;

// 返信そのものの読み上げ。喋ることが無ければ null を返して画像側へ譲る。
// ここで state をそのまま返すと、新しい返信のストリーミング中ずっと画像側へ
// 制御が渡らず、前の返信に紐づく生成の開始・完了が読み上げられんくなる。
const reduceReply = (
  state: AnnouncementState,
  { messages }: AnnouncementInput,
): AnnouncementState | null => {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return null;

  if (last.isStreaming) {
    // 一度この id を掴んだら、以降は画像側へ譲る。text の一致で判定すると、
    // 画像側が「画像を生成中」を書いた次の描画でここが THINKING へ差し戻し、
    // 生成の開始も完了も読み上げられんまま消費されてまう（本文が空の間ずっと）。
    // 本文が空の窓は、ユーザーが次を送った直後そのものなので必ず踏む。
    if (state.streamedId === last.id) return null;
    // 本文が一文字も無い間だけ「考えとる」を出す。以降は本文が伸びても文言を
    // 据え置くので、トークンごとの読み直しは起きん。
    const text = last.content.trim().length === 0 ? THINKING_LABEL : state.text;
    return { ...state, streamedId: last.id, text };
  }

  if (state.streamedId !== last.id) return null;

  const text = stripXmlTags(last.content);
  return { ...state, text: text.length > 0 ? text : state.text, streamedId: null };
};

// 画像は最後のメッセージとは限らん。生成の待ち時間中にユーザーが次を送れるので、
// 対象の id が末尾から外れても開始・完了を取りこぼさんよう、生成中の id を直接見る。
const reduceImage = (
  state: AnnouncementState,
  { messages, generatingIds }: AnnouncementInput,
): AnnouncementState => {
  const startedId = [...generatingIds].find((id) => !(id in state.generating));
  if (startedId !== undefined) {
    return {
      ...state,
      generating: { ...state.generating, [startedId]: findImageUrl(messages, startedId) },
      text: IMAGE_GENERATING_LABEL,
    };
  }

  const finishedId = Object.keys(state.generating).find((id) => !generatingIds.has(id));
  if (finishedId === undefined) return state;

  const { [finishedId]: before, ...rest } = state.generating;
  const finished = messages.find((message) => message.id === finishedId);
  // 会話を切り替えると messages ごと差し替わる。そのまま imageUrl 無しとみなすと、
  // 生成が成功しとっても「用意でけませんでした」と嘘を言う。判定材料が無いので黙る。
  if (!finished) return { ...state, generating: rest };

  // 失敗しても runImageGenerationTask の finally が id を外すので、生成が
  // 終わっただけでは届いた証拠にならん。開始時と別の画像が付いた時だけ到着。
  // 失敗を黙って落とすと「画像を生成中」のまま決着が伝わらんので、失敗も告げる。
  const after = finished.imageUrl ?? null;
  const arrived = after !== null && after !== before;
  return { ...state, generating: rest, text: arrived ? IMAGE_ARRIVED_LABEL : IMAGE_FAILED_LABEL };
};

// 同じ入力を再度通しても結果が変わらんように書く。描画中に state を進める都合上、
// 収束せんと再描画が止まらんくなる。
const reduceAnnouncement = (
  state: AnnouncementState,
  input: AnnouncementInput,
): AnnouncementState => reduceReply(state, input) ?? reduceImage(state, input);

/**
 * ライブリージョンへ流す一文を、状態が切り替わった瞬間だけ差し替える。
 *
 * ストリーミング中の本文は意図的に読ません。伸び続けるテキストをそのまま
 * ライブリージョンへ入れると、スクリーンリーダーがトークンごとに全文を
 * 読み直して沈黙より酷くなるため、確定してから一度だけ渡す。
 */
export const useChatAnnouncement = (
  messages: ChatMessage[],
  imageGeneratingMessageIds: Set<string>,
): string => {
  const [state, setState] = useState<AnnouncementState>(INITIAL_STATE);

  const next = reduceAnnouncement(state, { messages, generatingIds: imageGeneratingMessageIds });

  if (next !== state) setState(next);

  return next.text;
};
