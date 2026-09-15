import { stripXmlTagsStreaming } from "./xml-response-parser";

/**
 * 品質ガードのやり直し（撮り直し）が走った時に、画面へ何を出すかを決める。
 *
 * 撮り直しは 30〜40 秒かかる。その間ずっと本文を空にすると、読んどる最中に文章が
 * 消えて数十秒後に別の文が現れる。読み手から見れば故障で、没入が切れる。
 * かというて新しい本文を1文字目から出すと、長い旧本文が一気に縮んで同じ違和感が出る。
 *
 * そこで「新しい本文が旧本文に追いつくまでは旧本文を出したままにする」。
 * 画面上の文字が減る瞬間が原理的に消えて、切り替わりは1回だけになる。
 *
 * 比べるのは画面に出る文字数。生のストリームは <inner> や閉じてへんタグでも伸びるので、
 * 生の長さで判定すると「長いけど画面には何も出ん」チャンクで切り替わって空になる。
 */

export type RegenerateDisplayDecision = { kind: "hold" } | { kind: "show"; text: string };

const visibleLength = (text: string): number =>
  stripXmlTagsStreaming(text).replace(/\s+/gu, "").length;

export const decideRegenerateDisplay = (
  heldText: string | null,
  incomingText: string,
): RegenerateDisplayDecision => {
  if (heldText === null) return { kind: "show", text: incomingText };
  // 等長で解ける。旧本文と同じだけ画面に出るようになった時点で切り替えれば文字数は減らん
  if (visibleLength(incomingText) < visibleLength(heldText)) return { kind: "hold" };
  return { kind: "show", text: incomingText };
};
