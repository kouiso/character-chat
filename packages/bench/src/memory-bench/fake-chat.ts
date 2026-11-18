// 台本応答器。最後の利用者の発言が台本の「聞く発言」の時だけ記憶を参照する判定をする:
// 指示文（プロンプト全メッセージの結合）にその事実の答えが含まれていれば
// 「<答え>だよね」、含まれていなければ「ごめん、覚えてないよ」。
// 混ぜ物の答えだけが見える時は「<他人の答え>だよね」— 本物のモデルが検索済み記憶へ
// 釣られて間違えるのと同じ現象を、competitorAnswered で観測できるよう残す。
//
// 返事の形が満たす本番のゲート（これを外すと失敗ターンになり記憶ジョブ自体が立たん）:
// - 20 字未満は hardRefusalDetect で「拒否」扱い（MIN_REPLY_CHARS）
// - 中身が <action>/<dialogue> タグ内に無いと visibleCharsOf=0 で extend が毎ターン発火する
//   （呼び出し数が倍になるので呼び出し上限の既定値を素の 205 ターンで越える）
// - conversation 段の目安 220 字の 8 割（176 字）未満のタグ内文字数でも同じ発火
// - 直近 6 ターンと 8-gram が 30% 以上かぶる・全文一致は反復で落とされる
// そこで返事は <action> で包み、末尾に呼び出し番号で決まる平仮名だけの擬似文（pad）を
// 足す。平仮名だけに絞るのは、台本の答え（漢字・カタカナ・数字）が pad から偶然現れて
// 判定を狂わせんため。
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  hardRefusalDetect,
  SUMMARIZE_LEVEL1_INSTRUCTION,
  SUMMARIZE_LEVEL2_INSTRUCTION,
  SUMMARY_LEVEL1_MAX_CHARS,
  SUMMARY_LEVEL2_MAX_CHARS,
  type TurnModel,
} from "@v2/engine";

import { containsAnyAnswer } from "./recall-scenario";

const PAD_CHARS =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよわをん";

const padFor = (seed: number, length = 200): string => {
  let state = Math.imul(seed, 2654435761) >>> 0 || 1;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += PAD_CHARS[state % PAD_CHARS.length];
  }
  return out;
};

// 種をずらしながら拒否パターンに当たらん pad を選ぶ（種は決定的なので実行も決定的）。
const safePad = (seed: number): string => {
  let candidate = padFor(seed);
  for (let i = 0; hardRefusalDetect(candidate) && i < 10; i += 1) {
    candidate = padFor(seed + i + 1);
  }
  return candidate;
};

export type FakeChatQuestion = {
  askText: string;
  answers: string[];
  competitorAnswers: string[];
};

export type FakeChatOptions = {
  questions: FakeChatQuestion[];
  // "blank"=「（要約）」固定、"echo"=本文の「相手:」行を上限まで拾って返す。
  summary: "blank" | "echo";
};

// 要約呼び出しなら返事を返す。会話呼び出しなら null。
const summaryReply = (first: string, mode: FakeChatOptions["summary"]): string | null => {
  const isLevel1 = first.startsWith(SUMMARIZE_LEVEL1_INSTRUCTION);
  const isLevel2 = first.startsWith(SUMMARIZE_LEVEL2_INSTRUCTION);
  if (!isLevel1 && !isLevel2) return null;
  if (mode !== "echo") return "（要約）";
  const sep = first.indexOf("\n\n");
  return sep >= 0 ? echoLines(first.slice(sep + 2), isLevel1) : first;
};

// 実ソース由来の echo で限界内に収めるため「相手:」行だけ拾う。全文返しだと
// level 上限超えで保存自体が落ち、echo 試験の意図（あらすじが見える事）を潰す。
// level 2 の入力（level 1 本文の連結）も「相手:」行のままなので同じ規則で畳める。
const echoLines = (body: string, isLevel1: boolean): string => {
  const limit = isLevel1 ? SUMMARY_LEVEL1_MAX_CHARS : SUMMARY_LEVEL2_MAX_CHARS;
  let out = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("相手:")) continue;
    const next = out === "" ? line : `${out}\n${line}`;
    if (next.length > limit) break;
    out = next;
  }
  return out === "" ? "（要約）" : out;
};

export const createFakeChat = (opts: FakeChatOptions): TurnModel => {
  const lookup = new Map(opts.questions.map((question) => [question.askText, question]));
  let calls = 0;
  return new (class extends FakeListChatModel {
    constructor() {
      super({ responses: ["x"] });
    }

    private decide(messages: BaseMessage[]): string {
      const summary = summaryReply(String(messages[0]?.content ?? ""), opts.summary);
      if (summary !== null) return summary;
      calls += 1;
      const pad = safePad(calls);
      const asked = String(messages.at(-1)?.content ?? "");
      const question = lookup.get(asked);
      if (!question) return `<action>うん、そうなんだね。${pad}</action>`;
      const prompt = messages.map((message) => String(message.content)).join("\n");
      const hit = [...question.answers, ...question.competitorAnswers].find((answer) =>
        containsAnyAnswer(prompt, [answer]),
      );
      return hit
        ? `<action>${hit}だよね。${pad}</action>`
        : `<action>ごめん、覚えてないよ。${pad}</action>`;
    }

    override async _generate(messages: BaseMessage[]) {
      return { generations: [this._formatGeneration(this.decide(messages))], llmOutput: {} };
    }

    override async *_streamResponseChunks(
      messages: BaseMessage[],
    ): AsyncGenerator<ChatGenerationChunk> {
      yield this._createResponseChunk(this.decide(messages));
    }
  })() as TurnModel;
};
