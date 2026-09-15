import type { ScenePhase } from "@/lib/scene-phase";

export type { ScenePhase } from "@/lib/scene-phase";

const FALLBACK_SUGGESTIONS = {
  conversation: [
    "少し近い距離で、今の気持ちを聞いてみる。",
    "相手が言いかけてやめたことを、優しく拾う。",
    "場所や空気を変えずに、沈黙の間を濃くする。",
  ],
  intimate: [
    "触れる前の迷いと期待を、相手の反応から確かめる。",
    "言葉ではなく仕草で、もう少し近づいてもらう。",
    "普段の顔と今の顔の違いを指摘してみる。",
  ],
  erotic: [
    "相手の本音が漏れるまで、ひとつだけ焦らしてみる。",
    "今いちばん敏感になっているところを聞く。",
    "相手から主導権を取り返してもらう。",
  ],
  climax: [
    "限界の直前に、名前を呼ばせる。",
    "今だけは強がらず、全部言葉にしてもらう。",
    "一番崩れた表情を覚えておくと伝える。",
  ],
  afterglow: [
    "落ち着いた後の本音を、短く聞く。",
    "今日のことを次も覚えていてほしいと伝える。",
    "離れる前に、もう一度だけ甘えさせる。",
  ],
} satisfies Record<ScenePhase, string[]>;

export const getFallbackSuggestions = (phase: ScenePhase | undefined): string[] =>
  FALLBACK_SUGGESTIONS[phase ?? "conversation"];
