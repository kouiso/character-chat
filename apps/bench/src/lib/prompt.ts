import type { ChatMessage } from "./openrouter.ts";

// P1 の組み立てはこれだけ。既存の 10,150 行を丸ごと持ってきたら同じ轍を踏むので、
// system prompt 1本＋長さ指定＋履歴から始める。フェーズもシーン状態も入れとらん。
// 足りんことが数字で分かってから足す。

export type PromptConfig = {
  /** character.system_prompt をそのまま使う */
  characterPrompt: string;
  /** 1発話に期待する文字数。長さ軸の分母にもなる */
  responseLength: number;
  /** 生タグ漏れの再現条件を作るため、XML 出力を要求するかを切り替える */
  useXmlEnvelope: boolean;
  /** 相手が宣言した行為を必ず起こす指示を入れるか。既定は入れん（局長の承認前に台の挙動を変えんため） */
  requireClimaxFollowThrough?: boolean;
};

export function buildSystemPrompt(config: PromptConfig): string {
  const lines = [config.characterPrompt.trim(), "", "【出力の決まり】"];
  lines.push(
    `- 1回の返答は日本語で ${config.responseLength} 字前後。短く切り上げず、五感の具体描写で埋める。`,
    "- 説明で済ませず、見えたもの・聞こえた音・触れた感触・匂い・味を書く。",
    "- 相手に語りかけ、次の一手が生まれる形で終える。",
  );
  // 2026-09-01 の実測: 4モデル 10回中10回、相手が「出す」と宣言した次の返事で
  // その行為を起こさず流した。指示に書いてへんかったからや。
  if (config.requireClimaxFollowThrough === true)
    lines.push(
      "- 相手が「これから〜する」と宣言したら、次の返答でその行為が実際に起きた瞬間を書く。",
      "- 起きた後の状態へ飛ばさず、起きとる最中を身体の内側から書く。量・温度・流れ・脈・広がりを具体で書く。",
      "- 山場を要約・省略・暗示で済ませたらアカン。一番長く書くのはそこや。",
    );
  if (config.useXmlEnvelope) lines.push("- 本文全体を <response> と </response> で囲む。");
  else lines.push("- タグやマークアップは一切書かず、本文だけを出す。");
  return lines.join("\n");
}

export function buildMessages(config: PromptConfig, history: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: buildSystemPrompt(config) }, ...history];
}

/** 剥がし損ねを再現できるよう、剥がす処理はあえて分離しとく */
export function stripEnvelope(text: string): string {
  return text
    .replace(/<\/?response[^>]*>/gi, "")
    .replace(/<\/?action[^>]*>/gi, "")
    .trim();
}
