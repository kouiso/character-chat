import { Sparkles, Clapperboard, Brain, Zap, BookmarkPlus } from "lucide-react";

export const SOLO_ACTIONS = [
  {
    label: "続き",
    icon: Sparkles,
    mode: "send",
    prompt: "今の流れを止めずに、あなたから自然に続きを進めて。",
  },
  {
    label: "行動",
    icon: Clapperboard,
    mode: "send",
    prompt:
      "こちらの返事を待たずに、あなたから一歩だけ行動して。あなたらしい仕草と反応で場面を動かして。",
  },
  {
    label: "本音",
    icon: Brain,
    mode: "send",
    prompt: "今、口に出していない本音を少しだけ見せて。表の台詞とのギャップも出して。",
  },
  {
    label: "急展開",
    icon: Zap,
    mode: "send",
    prompt: "この場面に、あなたらしい小さな急展開を起こして。無理に大事件にはしないで。",
  },
  {
    label: "覚えて",
    icon: BookmarkPlus,
    mode: "insert",
    prompt: "覚えておいて: ",
  },
] as const;
