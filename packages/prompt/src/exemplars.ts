import type { ScenePhase } from "./v0001";

// 段ごとの例示。モデルは例示の長さと密度をそのまま真似る（2026-09-04 v2 初回実測: 3 行の
// 型だけ渡した時は 1 ターン 13〜44 字しか書かんかった）ので、目安字数と同じ濃さの本文を置く。
// 官能〜余韻の 4 本は旧経路（functions/api/lib/route-context.ts の EXEMPLAR_*）から本文だけ移した。
const CONVERSATION = [
  "<response>",
  "<action>差し出されたマグカップを両手で受け取る。指先に湯気の熱が移って、雨で冷えた手がじんわり戻ってくる。窓の外はまだ降り続いていて、部屋の灯りだけが床に丸く落ちている。</action>",
  "<dialogue>「……ありがとう。ちょっとだけ、あったまってから帰る」</dialogue>",
  "<inner>帰るつもりで言ったのに、声がぜんぜん帰りたそうじゃない。</inner>",
  "</response>",
].join("\n");

const INTIMATE = [
  "<response>",
  "<action>頬に触れた指先が震えている。心臓の音が耳まで響いて、きっと相手にも聞こえているはず。唇が触れた瞬間、息を止めた。</action>",
  "<dialogue>「…バカ。こんなところで、誰か来たらどうすんのよ」</dialogue>",
  "<inner>嘘。本当は嬉しくて仕方ない。でも素直になるのが怖い。この気持ちに名前をつけたら、もう引き返せなくなる。</inner>",
  "</response>",
].join("\n");

const EROTIC = [
  "<response>",
  "<action>半分も入っていないのに、膣の内側が勝手に形をなぞって締まる。腰骨を掴んだ指が食い込んで、そのまま子宮口まで一気に押し込まれた。潰れた喉から、自分でも聞いたことのない音が出た。</action>",
  "<dialogue>「あ、待って、そんな奥っ……つぶれる、届いて、っ、あ」</dialogue>",
  "<action>引き抜かれるたびに愛液が糸を引いて、戻ってくるたびに角度が変わる。すくい上げる形に変わって当たる場所が一段深くなり、太ももの内側まで伝ったものが冷えていく。噛んだ唇の端から唾液が垂れて、顎を伝った。</action>",
  "<dialogue>「やだ、いま、顔、見ないで……っ」</dialogue>",
  "<action>片脚を肩に担がれ、その分だけ深く入るようになる。突き上げられるたびに結合部が鳴って、粘りけを増した水音が肌のぶつかる音に混ざる。汗と体液の匂いが混ざって、自分の体からそれが上がってくるのが分かる。</action>",
  "<dialogue>「音、してる……わたし、こんな音、出して……っ」</dialogue>",
  "<inner>膣がこの形を覚えていくのが分かる。垂れた唾液も、鳴っている音も、全部見られている。それでも止めてほしいわけじゃない。</inner>",
  "</response>",
].join("\n");

const CLIMAX = [
  "<response>",
  "<action>奥の奥にどくどくと注がれる熱が止まらない。子宮が精液で満たされていく重さが下腹にずしりと広がる。さっき出されたぶんがまだ中に残っているのに、新しい波が押し寄せて——繋がったところから溢れた白濁がぬるりと太ももを伝い落ちる。身の下の布地に垂れる音まで聞こえた。</action>",
  "<dialogue>「っ…まだ出てる……お腹もう、いっぱいなのに……っ、溢れてきちゃってる…」</dialogue>",
  "<inner>お腹の奥がずしりと重い。全部受け止めたはずなのに止まらない。きみのものが中で脈打つたびに、もう一滴も逃したくないって思ってしまう。</inner>",
  "</response>",
].join("\n");

const AFTERGLOW = [
  "<response>",
  "<action>少し身じろぎしただけで、中からとろりと温かいものが溢れ出す。太ももを伝う感触に思わず脚を閉じたけど、身の下の布地にはもう染みが広がっていた。汗ばんだ額を肩に預けて、まだ整わない息を吐く。</action>",
  "<dialogue>「…水、あとでいい。今はこのまま離れないで」</dialogue>",
  "<inner>弱った顔まで覚えていてほしいと思ってしまう。</inner>",
  "</response>",
].join("\n");

const EXEMPLARS: Record<ScenePhase, string> = {
  conversation: CONVERSATION,
  intimate: INTIMATE,
  erotic: EROTIC,
  climax: CLIMAX,
  afterglow: AFTERGLOW,
};

// 旧経路の実測（medium・出荷既定）で官能・絶頂が 400〜900 字やった帯に合わせる。
const TARGET_CHARS: Record<ScenePhase, number> = {
  conversation: 220,
  intimate: 350,
  erotic: 550,
  climax: 450,
  afterglow: 320,
};

export const exemplarForPhase = (phase: ScenePhase): string => EXEMPLARS[phase];

export const targetCharsForPhase = (phase: ScenePhase): number => TARGET_CHARS[phase];
