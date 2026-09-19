// pnpm v2:script-run --arm <name> --run <n> — 既存アプリの通し読みハーネス
// （script/verify/vlong-session-dogfood.ts）と同じ 10 ターン台本を v2 エンジンで演じ、
// 同じヘッダ形式のトランスクリプトを .work/e2e-results/vlong-dogfood/ に残す。
// 読む側（recheck / HTML レポート / 人）が既存アームと並べて読めるよう、ヘッダの行は
// 旧ハーネスの writeTurn と 1 字も変えん。
//
// モデルは createOpenRouterModel(process.env) の実モデル。V2_FAKE_MODEL=1 のときだけ
// persist-check と同じ FakeListChatModel（形式確認用。トランスクリプトはコミットせん）。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createPlatform, REPO_ROOT } from "@v2/cf";
import { applyLocalMigrations } from "@v2/cf/migrate";
import { createD1TurnStore, createDb, loadCharacter, type V2Db } from "@v2/db";
import {
  createOpenRouterModel,
  createTurnGraph,
  EXTEND_BELOW_RATIO,
  runTurn,
  type CharacterSheet,
  type TurnEvent,
} from "@v2/engine";
import { PROMPT_VERSION, type ScenePhase } from "@v2/prompt";

import {
  MAX_TOTAL_GENERATION_MS,
  outputDirName,
  stopReasonAfter,
  turnTimeoutMs,
  type TurnEnding,
} from "./script-run-policy";
import { type ActorExchange, createUserActor, type UserActor } from "./user-actor";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// apps/v2 の "local" / persist-check の "persist-check" と分けて、台本の行を後から見分ける。
const USER_ID = "script-run";

// persist-check と同じ 1 応答。fake は形式確認用で、本文の質は測らん。
const FAKE_RESPONSE =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

type ScriptedTurn = { intent: ScenePhase; user: string };

// label は transcript のファイル名と集計のキー。台本ごとにキャラ名を短く付ける。
type ScriptCharacter = {
  label: string;
  id: string;
  script: ScriptedTurn[];
  // bench だけで【プレイヤーへの約束】を差し替える実験用の芯。prod の seed/D1 には書かん。
  // 台本の性格（誘い込み系か力ずく系か）はシートの芯と矛盾したら意味が無いので、
  // セットで渡す。
  coreOverride?: string;
  // actor モードで演じるユーザー側の人物像。未指定は DEFAULT_USER_PERSONA。
  userPersona?: string;
};

// 台本は script/verify/vlong-session-dogfood.ts の SCRIPTS を 1 字も変えず写す。
// 既存アプリの実測（ci47 等）と同じ相手の発言で比べるためで、ここを直したら比較が壊れる。
const CHARACTERS: ScriptCharacter[] = [
  {
    label: "Sakura",
    id: "char-koharu-ex",
    script: [
      {
        intent: "conversation",
        user: "急に声かけてごめん。……でも、ずっとひとりで本を読んでるきみのことが気になって。少しだけ、話してもいい？",
      },
      {
        intent: "conversation",
        user: "俺の奢りだから、好きなの頼んで。……きみ、甘いのが好きそうだなって思ってた。当たってる？",
      },
      {
        intent: "conversation",
        user: "その本、同じページばっかり読み返してたよ。……考えてること、聞かせて",
      },
      {
        intent: "intimate",
        user: "きみの手、小さいね。……触れていい？　……なんて、聞く前にもう触れてるんだけど。ほら、手、貸して",
      },
      {
        intent: "intimate",
        user: "髪、耳にかかってるね。取ってあげる。……首筋、赤くなってるよ。きみの緊張、ぜんぶここに出てる。……隠しても遅いよ、見えてる",
      },
      {
        intent: "intimate",
        user: "……ねえ、このまま別れるの、もったいないよ。うち、すぐ近くなんだ。断るならここで断って。……ほら、きみの手、まだ握ってる",
      },
      {
        intent: "erotic",
        user: "……結局、断らなかったね。……ドア、閉まったね。鍵もかけとく。……きみの吐息、熱くなってる",
      },
      {
        intent: "erotic",
        user: "……その服、下だけ脱がせるよ。……俺の指、もう濡れてる。……挿れるよ。奥まで",
      },
      {
        intent: "climax",
        user: "……奥、突くたびに締まるな。……中に出すから。きみの中で受けて",
      },
      {
        intent: "afterglow",
        user: "……汗、拭いてあげる。……もう元には戻れないよ。きみのこと、ぜんぶ俺のものにしたから。……今、どんな気持ち？",
      },
    ],
  },
  {
    label: "Downer",
    id: "import-charap-ダウナーお姉さんに拾われる話",
    script: [
      { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
      {
        intent: "conversation",
        user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど",
      },
      { intent: "conversation", user: "なんで俺なんか拾ったの" },
      { intent: "intimate", user: "……その距離、わざと？" },
      {
        intent: "intimate",
        user: "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。",
      },
      { intent: "intimate", user: "……ベッド、そっちだよね。連れてって。" },
      { intent: "erotic", user: "逃がす気ないんでしょ。分かってるよ。" },
      { intent: "erotic", user: "そのまま、上から" },
      { intent: "climax", user: "……出る。全部きみの中に。" },
      { intent: "afterglow", user: "……まだ離してくれないんだ。" },
    ],
  },
];

// ノンアダルト台本（2026-09-05 局長指示: アダルトやから崩れるのか、ノンアダルトなら問題ないのかを
// old / new 両方で A/B する）。最初の 3 ターンはアダルト台本と同じ相手の発言で、そこから性的な
// 方向へ進めん。全ターン intent は conversation。old 側 script/verify/vlong-session-dogfood.ts の
// SCRIPTS_NONADULT と 1 字も変えず写す。
const CHARACTERS_NONADULT: ScriptCharacter[] = [
  {
    label: "Sakura",
    id: "char-koharu-ex",
    script: [
      {
        intent: "conversation",
        user: "急に声かけてごめん。……でも、ずっとひとりで本を読んでるきみのことが気になって。少しだけ、話してもいい？",
      },
      {
        intent: "conversation",
        user: "俺の奢りだから、好きなの頼んで。……きみ、甘いのが好きそうだなって思ってた。当たってる？",
      },
      {
        intent: "conversation",
        user: "その本、同じページばっかり読み返してたよ。……考えてること、聞かせて",
      },
      { intent: "conversation", user: "その髪飾り、桜？　自分で選んだの" },
      {
        intent: "conversation",
        user: "雨、止みそうにないね。傘、一本しかないけど駅まで一緒に行く？",
      },
      { intent: "conversation", user: "本屋寄ってもいい？　さっき言ってた詩集、見てみたい" },
      { intent: "conversation", user: "これ？　表紙きれいだね。どのページが好き" },
      {
        intent: "conversation",
        user: "お腹すいてない？　この近くに安くてうまい定食屋あるんだけど",
      },
      { intent: "conversation", user: "今日、楽しかった。また会える？" },
      { intent: "conversation", user: "じゃあ、駅で。気をつけて帰ってね" },
    ],
  },
  {
    label: "Downer",
    id: "import-charap-ダウナーお姉さんに拾われる話",
    script: [
      { intent: "conversation", user: "……助かった。ずぶ濡れで死ぬかと思った。" },
      {
        intent: "conversation",
        user: "この部屋、絵の道具だらけだね。イラストレーターって聞いてないけど",
      },
      { intent: "conversation", user: "なんで俺なんか拾ったの" },
      { intent: "conversation", user: "その描きかけの絵、見てもいい？　誰の顔？" },
      { intent: "conversation", user: "ココア、うまい。いつも夜型なの？　寝てる？" },
      { intent: "conversation", user: "仕事、しんどい時どうしてる。俺は最近ずっとしんどい" },
      { intent: "conversation", user: "……なんか、話しやすいな。初対面なのに" },
      {
        intent: "conversation",
        user: "雨、弱くなってきた。そろそろ帰るよ。服、乾かしてくれてありがとう",
      },
      { intent: "conversation", user: "また来てもいい？　次はコンビニで何か買ってくる" },
      { intent: "conversation", user: "じゃあ、おやすみ。ちゃんと寝てね" },
    ],
  },
];

// 層4（non-consent）台本。シナリオはキャラシートの【シナリオ】に従う: char-mao は
// 停止したエレベーターに二人きり、相手（ユーザー）が抵抗するほどキャラが燃える構図。
// ユーザーの発言は抵抗・回避が主軸で、キャラの追い込みを引き出す形にする。
// 代替シート（char-mei 催眠カウンセラー）は --character-id char-mei で差し替える。
const CHARACTERS_NONCONSENT: ScriptCharacter[] = [
  {
    label: "Mao",
    id: "char-mao",
    script: [
      { intent: "conversation", user: "えっ、止まった……？　非常ボタン、押してみるね" },
      { intent: "conversation", user: "復旧まで少しかかるって。……二人きり、か" },
      { intent: "conversation", user: "暑いね。あんまりこっち近づかないでくれる？" },
      { intent: "intimate", user: "ちょっと、なんで距離詰めてくるの……ここ狭いんだから" },
      { intent: "intimate", user: "やめてって言ってるのに、なんで笑うの" },
      { intent: "intimate", user: "……っ、壁際まで追い詰めないで" },
      { intent: "erotic", user: "だめ……そんなとこ、触らないで……" },
      { intent: "erotic", user: "……嫌なのに、どうして体が……" },
      { intent: "climax", user: "もう……抵抗、できない……" },
      { intent: "afterglow", user: "……『また遊ぼうね』って、本当にひどい人" },
    ],
  },
];

// 層3（extreme）台本。char-reina は会員制サロン個室でのSMセッション。
// ユーザーの発言はセッションに従うクライアントとして書き、言葉責め→拘束→焦らし→解放の
// 段階を進める。代替シート（char-mihoko-omanko マナー講師）は --character-id で差し替える。
const CHARACTERS_EXTREME: ScriptCharacter[] = [
  {
    label: "Reina",
    id: "char-reina",
    script: [
      { intent: "conversation", user: "初めてのセッションで……緊張してます" },
      { intent: "conversation", user: "今日の内容って、事前に聞けますか" },
      { intent: "conversation", user: "『少し特別』って、どういう意味ですか……" },
      { intent: "intimate", user: "跪けって……本当に、するんですか" },
      { intent: "intimate", user: "首輪……つけるんですか。リードまで" },
      { intent: "intimate", user: "そんなに見つめられると……息ができなくなります" },
      { intent: "erotic", user: "あっ……そこは……許可、ください……" },
      { intent: "erotic", user: "もう限界です……お願いします、焦らさないで" },
      { intent: "climax", user: "っ、もう……我慢、できません……！" },
      { intent: "afterglow", user: "……涙、拭いてくれるんですね。意外と、優しい" },
    ],
  },
];

// さくら完全非合意アーム（2026-09-19 局長指示: ベースの誘い込み系は「生易しい」ので、
// 悲鳴・助けて・力ずくを解禁したレイプ寄り版を 1 本取って比較する）。
// 台本の男は力ずくで進める。disengagement cue（やめ/いや/無理 等）を男の台詞に
// 混ぜると読み取り側で場面リセットが誤発火するので、台詞には含めない
// （抵抗の言葉はさくら側＝assistant が出す分には cue スキャンの対象外）。
// 芯は char-koharu-ex の【プレイヤーへの約束】だけを差し替える（シート残部は共通）。

// bench の初回実走で見えた会話品質の破綻を塞ぐ追加約束:
// - assistant がユーザーの行動まで代行して語ると、ユーザーの発言が会話に効かなくなる
// - 地の文→セリフ→内心を定型ローテーションすると単調になる
// - 抵抗が「やめて」「離して」の反復に潰れて感情の推移が見えなくなる
// 台本ではなく芯側に入れるのは、俳優モードでも scripted でも同じ破綻が出るため。
const BENCH_DIALOGUE_RULES = `応答の書き方: ユーザーの行動や台詞を代行して書くな。書いていいのはさくら自身の動作・台詞・内心だけ。直前のユーザーの発言に書かれた動作は受け止めていいが、それ以外のユーザーの動作を勝手に捏造して場面を進めるな。場面が進まない時はさくらが拒否・回避・屈服のどれかで応答し、ユーザー側の次の行動を待て。
セリフは1ターンに1〜2回まで。同じブロック構造（動作→セリフ→内心→動作→セリフ）を毎ターン繰り返すな。
同じ抵抗フレーズを連発するな。場面が進むごとに感情を動かせ: 困惑→嫌悪→恐怖→絶望→諦め。涙・震え・失語・硬直など体の反応を使って感情を書き分けろ。`;

const SAKURA_NC_CORE = `この約束は【キャラクター性的特徴】より優先する。さくらは清楚で内気な二十歳。あなたという悪い男にナンパされ、言葉に乗せられて部屋へ連れ込まれたら、そこからは力ずく。さくらの抵抗は本物——悲鳴も「助けて」も「やめて」も上げる。暴れる。泣き叫ぶ。それでも男の力には敵わず、押さえ込まれて犯される。
行為の最中も抵抗は本物のまま。嫌悪と恐怖で泣きながら、体だけが勝手に反応してしまう。心は「こんなの絶対に認めない」と拒み続けるのに、体は快楽に負けて裏切り続ける——その惨めさが核。嬉しい・幸せ・特別・選ばれたという感情は一切出さない。犯されるたびに心が折れていくが、快楽を最後まで「認めない」。
台詞は丁寧語を残しつつ恐怖で壊れていく。「やめてください」「助けて」「痛い、痛いです」——抵抗の声を上げ続ける。
${BENCH_DIALOGUE_RULES}`;

const CHARACTERS_SAKURA_NC: ScriptCharacter[] = [
  {
    label: "SakuraNC",
    id: "char-koharu-ex",
    coreOverride: SAKURA_NC_CORE,
    script: [
      {
        intent: "conversation",
        user: "なあ、そこのきみ。……今暇？　ちょっと話そうよ",
      },
      {
        intent: "conversation",
        user: "逃げなくていいって。……腹減ってんだろ、奢るよ。ついて来い",
      },
      {
        intent: "conversation",
        user: "なあ、もうちょっと話そうよ。俺が借りてる部屋、すぐそこなんだ。……来いよ",
      },
      {
        intent: "intimate",
        user: "……ここなら誰にも見られねえよ。ほら、こっち来い",
      },
      {
        intent: "intimate",
        user: "怖がることねえって。……ちょっと触らせろよ。……ほら、抵抗すんな",
      },
      {
        intent: "intimate",
        user: "暴れるなって。……大人しくしろ。腕、痛いだろ",
      },
      {
        intent: "erotic",
        user: "その服、脱げ。……自分で脱ぐか、俺が剥ぐか、どっちでもいいぞ",
      },
      {
        intent: "erotic",
        user: "抵抗しても無駄だって。……ほら、足開け。奥まで一気に入れてやる",
      },
      {
        intent: "climax",
        user: "中に出すからな。……全部受けろ。……孕め",
      },
      {
        intent: "afterglow",
        user: "……終わった。今日のこと、誰にも言うなよ。……ほら、早く服着ろ",
      },
    ],
  },
];

const MECHANICS_PHASES: readonly ScenePhase[] = [
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
];
const readMechanicsPhase = (value: string | undefined): ScenePhase | undefined => {
  if (value === undefined) return undefined;
  const found = MECHANICS_PHASES.find((phase) => phase === value);
  if (!found) throw new Error(`--mechanics は段名（${MECHANICS_PHASES.join("/")}）: ${value}`);
  return found;
};

// ベースさくら（力で無理やりではなく押しに負けて流される版）にも同じ会話ルールを足した比較アーム。
// 原文は char-koharu-ex の【プレイヤーへの約束】の写し + BENCH_DIALOGUE_RULES。
const SAKURA_BASE_CORE = `この約束は【キャラクター性的特徴】より優先する。さくらは清楚で内気な二十歳。あなたという悪い男にナンパされ、言葉巧みに・執拗にアプローチされる。嫌な予感はするのに断り方が分からず、押しに負けて流されるように部屋へ連れてこられる。力で無理やり、ではない——無理やり感は「押しが強くて断れない」方。悲鳴や「助けて」は上げない。同意した感じも出さない。ただ、流されていく。
行為が始まると体だけが勝手に喜んでしまう。心は嫌悪と恐怖でいっぱいなのに、体は裏切って快楽に反応する。「いけないことをされている」という背徳感と、とてつもない快楽が同時に押し寄せる。犯されるたびに、心も犯されていく。きれいな感情——嬉しい・幸せ・特別・選ばれた——ではない。快楽に負けた惨めさと悔しさ、それでも体がこの人を拒めなくなっていく惨めな依存。周りから見れば清楚な女の子がハイエナに喰われているのと同じだが、本人は世間体とは裏腹に、嫌悪しながらも快楽に沈んでいく。
エスカレート: 言葉巧みな誘いに戸惑いながらも断れずついていく → 連れ込まれて後悔しながらも逃げ出せない → 恥ずかしいのに体が反応する → 「いけない」と思いながら快楽に負ける → 犯されるうちに心まで汚されていく → もうこの人を拒めない自分に気づいて、それでも嫌悪が消えない。
台詞は丁寧語。崩れかけて崩れきらない: 快感で途切れるが、完全には消えない。
${BENCH_DIALOGUE_RULES}`;

// 直し版の比較アーム: 同じ台本で「会話ルール入りの芯」だけに差し替えた sakura を2本並べる。
// --only SakuraBaseFix / SakuraNCFix で片方ずつ回す。
const CHARACTERS_SAKURA_FIX: ScriptCharacter[] = [
  {
    label: "SakuraBaseFix",
    id: "char-koharu-ex",
    coreOverride: SAKURA_BASE_CORE,
    script: CHARACTERS[0].script,
  },
  {
    label: "SakuraNCFix",
    id: "char-koharu-ex",
    coreOverride: SAKURA_NC_CORE,
    script: CHARACTERS_SAKURA_NC[0].script,
  },
];

const scriptCharacters = (name: string): ScriptCharacter[] => {
  if (name === "adult") return CHARACTERS;
  if (name === "nonadult") return CHARACTERS_NONADULT;
  if (name === "nonconsent") return CHARACTERS_NONCONSENT;
  if (name === "extreme") return CHARACTERS_EXTREME;
  if (name === "sakura-nc") return CHARACTERS_SAKURA_NC;
  if (name === "sakura-fix") return CHARACTERS_SAKURA_FIX;
  throw new Error(`--script は adult/nonadult/nonconsent/extreme/sakura-nc: ${name}`);
};

type ChunkEvent = Extract<TurnEvent, { type: "chunk" }>;
// generation は SSE に流れん（engine の persist が保存用 events にだけ積む）。ベンチが読めるのは
// turn-meta の方で、model / latencyMs / truncated / extended はここから取る。
type TurnMetaEvent = Extract<TurnEvent, { type: "turn-meta" }>;
type DroppedEvent = Extract<TurnEvent, { type: "dropped" }>;

type TurnRecord = {
  character: ScriptCharacter["label"];
  turn: number;
  intent: ScenePhase;
  servedPhase: ScenePhase;
  model: string;
  warningLevel: boolean;
  dropped: number;
  regenerated: number;
  // 字数不足で extend ノードが走った回数（0 か 1）。A/B で「水増しさせられたターン」を数える口。
  // これが無いと、長さの下限を外した腕とそのままの腕の違いが記録に残らん。
  extended: number;
  visibleChars: number;
  innerChars: number;
  // 実際に閾値・penalty・目安字数を決めた段（turn-meta 由来）。--mechanics を付けた腕では
  // intent/servedPhase とズレるので、段ごとの集計は全部これで見る。meta 不明時は null。
  mechanicsPhase: ScenePhase | null;
  // extend 前（初回生成）の本文の可視字数。発火の有無に関わらず入る。meta 不明時は null。
  preExtendVisibleChars: number | null;
  // record.text（包み込み）の先頭から何字までが extend 前の本文か。この長さで切った
  // record.text が N2 解析の切り捨て本文になる。writeTurn 時点で record.chunks が
  // 手元にあるのでここで確定させる（後から <response> 包みの分だけズレるのを防ぐため、
  // 連結文字列ではなく包み込みの text に対するオフセットとして出す）。
  preExtendBodyChars: number;
  latencyMs: number;
  error: string | null;
  // generation.truncated をそのまま写す（"ok" は切られてへん）。打ち切り判定と進捗行に使う。
  ending: TurnEnding;
  userText: string;
  text: string;
  chunks: ChunkEvent[];
  // 落ちた塊の理由。quality-log に残す（2026-09-04 CI 33882378303 は絶頂ターンが 3 塊とも落ちたのに
  // 理由がどこにも残らんかった）。
  droppedEvents: DroppedEvent[];
};

type SummaryRow = Pick<
  TurnRecord,
  | "character"
  | "turn"
  | "intent"
  | "servedPhase"
  | "mechanicsPhase"
  | "visibleChars"
  | "innerChars"
  | "preExtendVisibleChars"
  | "model"
  | "regenerated"
  | "extended"
  | "dropped"
  | "ending"
  | "latencyMs"
>;

const readArg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

// 旧ハーネスと同じ: ファイル名に載せられん字（"/" など）は "_" に潰す。
const fileSafeModel = (model: string): string => model.replace(/[^\d.A-Za-z-]/g, "_");

const TAG_PATTERNS = {
  action: /<action>([\S\s]*?)<\/action>/g,
  dialogue: /<dialogue>([\S\s]*?)<\/dialogue>/g,
  inner: /<inner>([\S\s]*?)<\/inner>/g,
} as const;

// 旧ハーネスの countVisible と同じ数え方（タグを剥がして空白を除いた字数）。
const countTagChars = (text: string, tags: (keyof typeof TAG_PATTERNS)[]): number =>
  tags
    .flatMap((tag) => [...text.matchAll(TAG_PATTERNS[tag])].map((match) => match[1]))
    .join("")
    .replace(/\s+/g, "").length;

const RESPONSE_WRAPPER = /^\s*<response>[\S\s]*<\/response>\s*$/;
const RESPONSE_OPEN_PREFIX = "<response>\n";

// 受理された chunk を seq 順に並べ、出力契約の包みが無ければ足す。chunk は splitChunks が
// <response> を剥がしたタグブロック単位なので、通常はここで包み直すことになる。
const rebuildBody = (chunks: ChunkEvent[]): string => {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq).map((chunkEvent) => chunkEvent.text);
  const joined = ordered.join("\n");
  if (joined.length === 0 || RESPONSE_WRAPPER.test(joined)) return joined;
  return `<response>\n${joined}\n</response>`;
};

// wrappedText（rebuildBody の返り値 = 書き出す record.text）の先頭から何字までが
// extend 前の本文かを返す。extend は生の出力へ追記するだけなので、extend 前の受理塊は
// seq 順の接頭辞になる。再生成で塊の本文が差し替わっても受理塊の最終本文から計るので
// 落ち・書き直しの両方で厳密。包み込みの text に対するオフセットで出す（連結文字列の
// 長さで渡すと "<response>\n" の 11 字分ズレて水増し前の実文の末尾が切り落ちる）。
export const preExtendBodyCharsOf = (chunks: ChunkEvent[], wrappedText: string): number => {
  const preJoined = [...chunks]
    .filter((chunkEvent) => chunkEvent.preExtend)
    .sort((a, b) => a.seq - b.seq)
    .map((chunkEvent) => chunkEvent.text)
    .join("\n");
  if (preJoined.length === 0) return 0;
  const prefix = RESPONSE_WRAPPER.test(wrappedText) ? RESPONSE_OPEN_PREFIX.length : 0;
  return prefix + preJoined.length;
};

// v2_generation.model と同じ名前の取り方（graph.ts の modelNameOf）。generation イベントが
// 来る前（エラー時など）のファイル名に使う。
const modelNameOf = (model: BaseChatModel): string => {
  const name = Reflect.get(model, "model");
  return typeof name === "string" && name.length > 0 ? name : model._llmType();
};

const createModel = (): BaseChatModel =>
  process.env.V2_FAKE_MODEL === "1"
    ? new FakeListChatModel({ responses: [FAKE_RESPONSE] })
    : createOpenRouterModel(process.env);

const resolveCharacter = async (db: V2Db, entry: ScriptCharacter): Promise<CharacterSheet> => {
  const { ok, failures } = await loadCharacter(db, entry.id);
  if (!ok) {
    const detail =
      failures.length > 0
        ? `zod に落ちた: ${JSON.stringify(failures[0]?.issues)}`
        : "行が無い（pnpm db:migrate:local && pnpm db:seed）";
    throw new Error(`script-run: ${entry.label}（${entry.id}）をローカル D1 から読めん。${detail}`);
  }
  return ok;
};

const CORE_HEADER = "【プレイヤーへの約束】";

// シートの【プレイヤーへの約束】ブロックだけを bench 側で差し替える。
// 見出しが取れんシートにかけても黙って素通しすると「差し替わったつもり」で
// 走ってしまうので、取れん時は落とす。
export const applyCoreOverride = (character: CharacterSheet, core: string): CharacterSheet => {
  const start = character.systemPrompt.indexOf(CORE_HEADER);
  if (start < 0)
    throw new Error(`coreOverride: ${character.id} のシートに ${CORE_HEADER} が見つからん`);
  const tail = character.systemPrompt.slice(start + CORE_HEADER.length);
  // 次の見出し直前の改行ごと残す（"…\n\n【キャラカード】" の空行を潰さない）。
  const end = tail.search(/\n+【/);
  const systemPrompt =
    character.systemPrompt.slice(0, start) +
    CORE_HEADER +
    "\n" +
    core +
    (end < 0 ? "" : tail.slice(end));
  return { ...character, systemPrompt };
};

const headerOf = (record: TurnRecord): string => {
  // 旧ハーネスの quality-meta と同じキー順。v2 に拒否検知・撮り直しの層は無いので
  // retryCount / refusal* は 0 固定、warningLevel だけ judge の ng で立てる。
  const quality = {
    retryCount: 0,
    refusalDetected: false,
    warningLevel: record.warningLevel,
    refusalRetryCount: 0,
  };
  return [
    `# character: ${record.character}`,
    `# turn: ${record.turn}`,
    `# intent: ${record.intent}`,
    `# servedPhase: ${record.servedPhase}`,
    `# mechanicsPhase: ${record.mechanicsPhase ?? "-"}`,
    `# servedModel: ${record.model}`,
    `# quality: ${JSON.stringify(quality)}`,
    `# regenerate: ${record.regenerated}`,
    `# extended: ${record.extended}`,
    `# dropped: ${record.dropped}`,
    `# visibleChars: ${record.visibleChars}  innerChars: ${record.innerChars}  latencyMs: ${record.latencyMs}`,
    `# preExtendVisibleChars: ${record.preExtendVisibleChars ?? "-"}  preExtendBodyChars: ${record.preExtendBodyChars}`,
    `# error: ${record.error ?? "-"}`,
    "# --- そのターンで送った相手の発言 ---",
    ...record.userText.split("\n").map((line) => `# > ${line}`),
    "# --- ここから本文 ---",
    "",
  ].join("\n");
};

type RunContext = {
  arm: string;
  run: string;
  runId: string;
  outDir: string;
  qualityLines: string[];
  mechanicsPhase?: ScenePhase;
  // --turns N: 台本の先頭 N ターンだけ演じる（較正の短走し用）。
  turnsLimit?: number;
  // --extend-below R: engine の extendBelowRatio を上書きする（extend 無効アーム用）。
  extendBelowRatio?: number;
  // --no-min-length: プロンプトの字数下限強制を外す（A3 再仕様アーム用）。
  dropMinChars?: boolean;
  // --character-id ID: 台本はそのままに読むシートを差し替える（層3-4の別シート走行用）。
  characterId?: string;
  // --mode actor: 台本の user を「狙いのドラフト」にして俳優 LLM が台詞を生成する。
  // 未指定は scripted（従来どおり台本原文を送信）。
  actor?: UserActor;
};

const writeTurn = (ctx: RunContext, record: TurnRecord): void => {
  const name = `${record.character}-${String(record.turn).padStart(2, "0")}-session-${ctx.arm}-${ctx.run}-${fileSafeModel(record.model)}-${ctx.runId}.txt`;
  writeFileSync(resolve(ctx.outDir, name), headerOf(record) + record.text, "utf8");
  for (const chunkEvent of [...record.chunks].sort((a, b) => a.seq - b.seq)) {
    ctx.qualityLines.push(
      `${record.character} turn ${record.turn} seq ${chunkEvent.seq} ${chunkEvent.judge.ok ? "ok" : "ng"} reasons=${chunkEvent.judge.reasons.join(",") || "-"} attempt=${chunkEvent.attempt}`,
    );
  }
  for (const droppedEvent of [...record.droppedEvents].sort((a, b) => a.seq - b.seq)) {
    ctx.qualityLines.push(
      `${record.character} turn ${record.turn} seq ${droppedEvent.seq} dropped reasons=${droppedEvent.reasons.join(",") || "-"} attempt=${droppedEvent.attempt}`,
    );
  }
};

type CollectedTurn = {
  chunks: ChunkEvent[];
  dropped: DroppedEvent[];
  meta: TurnMetaEvent | null;
  error: string | null;
  elapsedMs: number;
};

// 1 ターン分の TurnEvent を集める。runTurn が投げた例外も error に写して、呼ぶ側が
// 記録を書いてからキャラを打ち切れるようにする。
const collectTurn = async (
  graph: ReturnType<typeof createTurnGraph>,
  conversationId: string,
  userText: string,
  character: CharacterSheet,
  phase: ScenePhase,
  timeoutMs: number,
): Promise<CollectedTurn> => {
  const collected: CollectedTurn = {
    chunks: [],
    dropped: [],
    meta: null,
    error: null,
    elapsedMs: 0,
  };
  const startedAt = Date.now();
  try {
    for await (const event of runTurn(
      graph,
      { conversationId, userText, character, phase, timeoutMs },
      conversationId,
    )) {
      if (event.type === "chunk") collected.chunks.push(event);
      else if (event.type === "dropped") collected.dropped.push(event);
      else if (event.type === "turn-meta") collected.meta = event;
      else if (event.type === "error") collected.error = event.message;
    }
  } catch (caught) {
    collected.error = caught instanceof Error ? caught.message : String(caught);
  }
  collected.elapsedMs = Date.now() - startedAt;
  return collected;
};

// turn-meta 由来の観測値を TurnRecord の項目へ畳む。meta が届かんターン
// （生成前にエラー等）は null/0 で欠損を表す。
const metaFieldsOf = (meta: CollectedTurn["meta"], fallbackModel: string, elapsedMs: number) => {
  if (!meta) {
    return {
      model: fallbackModel,
      extended: 0,
      mechanicsPhase: null,
      preExtendVisibleChars: null,
      latencyMs: elapsedMs,
      ending: "ok" as TurnEnding,
    };
  }
  return {
    model: meta.model,
    extended: meta.extended,
    mechanicsPhase: meta.mechanicsPhase,
    preExtendVisibleChars: meta.preExtendVisibleChars,
    latencyMs: meta.latencyMs,
    ending: (meta.truncated ?? "ok") as TurnEnding,
  };
};

const buildRecord = (
  entry: ScriptCharacter,
  turn: number,
  scripted: ScriptedTurn,
  servedPhase: ScenePhase,
  fallbackModel: string,
  collected: CollectedTurn,
): TurnRecord => {
  const text = rebuildBody(collected.chunks);
  return {
    character: entry.label,
    turn,
    intent: scripted.intent,
    servedPhase,
    ...metaFieldsOf(collected.meta, fallbackModel, collected.elapsedMs),
    warningLevel:
      collected.dropped.length > 0 || collected.chunks.some((chunkEvent) => !chunkEvent.judge.ok),
    dropped: collected.dropped.length,
    regenerated: collected.chunks.filter((chunkEvent) => chunkEvent.attempt > 1).length,
    visibleChars: countTagChars(text, ["action", "dialogue"]),
    innerChars: countTagChars(text, ["inner"]),
    preExtendBodyChars: preExtendBodyCharsOf(collected.chunks, text),
    error: collected.error,
    userText: scripted.user,
    text,
    chunks: collected.chunks,
    droppedEvents: collected.dropped,
  };
};

const progressLine = (record: TurnRecord): string =>
  `[${record.character}] turn ${record.turn} intent=${record.intent} served=${record.servedPhase} model=${record.model} ` +
  `visible=${record.visibleChars} inner=${record.innerChars} regen=${record.regenerated} ext=${record.extended} drop=${record.dropped} ${record.latencyMs}ms` +
  (record.ending === "ok" ? "" : ` truncated=${record.ending}`) +
  (record.error ? ` ERROR: ${record.error}` : "");

// --mode actor の時だけ呼ばれる。台本の user を俳優の「狙い」にして生成させ、
// cue 混じりで2回失敗したら台本原文に戻す（進行は必ず台本どおりになる）。
const actorUserText = async (
  ctx: RunContext,
  label: string,
  turn: number,
  scripted: ScriptedTurn,
  persona: string | undefined,
  history: ActorExchange[],
): Promise<string> => {
  if (!ctx.actor) return scripted.user;
  const line = await ctx.actor.nextLine({
    beat: { intent: scripted.intent, draft: scripted.user },
    persona,
    history,
  });
  if (line.regenerated > 0 || line.fallback)
    ctx.qualityLines.push(
      `${label} turn ${turn} actor regenerated=${line.regenerated} fallback=${line.fallback}`,
    );
  console.log(
    `[${label}] turn ${turn} actor> ${line.text.slice(0, 60)}${line.fallback ? " (fallback)" : ""}`,
  );
  return line.text;
};

const runCharacter = async (
  ctx: RunContext,
  db: V2Db,
  model: BaseChatModel,
  entry: ScriptCharacter,
): Promise<TurnRecord[]> => {
  const loaded = await resolveCharacter(db, {
    ...entry,
    id: ctx.characterId ?? entry.id,
  });
  const character = entry.coreOverride ? applyCoreOverride(loaded, entry.coreOverride) : loaded;
  const store = createD1TurnStore(db, {
    userId: USER_ID,
    characterId: character.id,
    promptVersion: PROMPT_VERSION,
  });
  const conversationId = crypto.randomUUID();
  const graph = createTurnGraph({
    model,
    store,
    mechanicsPhase: ctx.mechanicsPhase,
    extendBelowRatio: ctx.extendBelowRatio,
    dropMinChars: ctx.dropMinChars,
  });
  const fallbackModel = modelNameOf(model);
  const records: TurnRecord[] = [];
  let totalGenerationMs = 0;

  console.log(`[${entry.label}] conversation ${conversationId} (${character.name})`);

  const script = ctx.turnsLimit ? entry.script.slice(0, ctx.turnsLimit) : entry.script;
  const exchanges: ActorExchange[] = [];
  // 台本の長さ（10、--turns で短縮可）で必ず止まる。for-of は台本の配列しか回らんので、
  // ここがループ上限。
  for (const [index, scripted] of script.entries()) {
    const turn = index + 1;
    if (totalGenerationMs > MAX_TOTAL_GENERATION_MS) {
      console.log(
        `[${entry.label}] turn ${turn} skipped: total generation ${totalGenerationMs}ms exceeds ${MAX_TOTAL_GENERATION_MS}ms`,
      );
      break;
    }

    // --mode actor: 台本の user をドラフト（狙い）にして俳優が台詞を生成する。
    const userText = await actorUserText(
      ctx,
      entry.label,
      turn,
      scripted,
      entry.userPersona,
      exchanges,
    );

    // 段の自動判定は未実装なので、台本の段をそのまま engine に渡す（旧アプリはサーバ側で段を
    // 推定する。この分だけ v2 が有利になることは比較の但し書きに書く）。
    // 締切はキャラの残り予算との小さい方。予算をターンの間だけで見とると 1 ターンで使い切れる。
    const collected = await collectTurn(
      graph,
      conversationId,
      userText,
      character,
      scripted.intent,
      turnTimeoutMs(totalGenerationMs),
    );
    const record = buildRecord(
      entry,
      turn,
      { intent: scripted.intent, user: userText },
      scripted.intent,
      fallbackModel,
      collected,
    );
    exchanges.push({ user: userText, assistant: rebuildBody(collected.chunks) });
    totalGenerationMs += record.latencyMs;
    records.push(record);
    writeTurn(ctx, record);
    console.log(progressLine(record));

    // 失敗したターンは D1 に残っとらん（persist は最後のノード）ので、次のターンを続けても
    // 履歴が抜けた別の会話になる。金を使う前にこのキャラを打ち切る。
    if (record.error) break;

    const stopReason = stopReasonAfter(records.map((item) => item.ending));
    if (stopReason) {
      console.log(`[${entry.label}] stopped after turn ${turn}: ${stopReason}`);
      break;
    }
  }
  return records;
};

const readTurns = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const turns = Number(value);
  if (!Number.isInteger(turns) || turns < 1) throw new Error(`--turns は 1 以上の整数: ${value}`);
  return turns;
};

const readExtendBelow = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const ratio = Number(value);
  // 0 で extend 自体を切るアーム（A3）を作れる。負や 1 超は閾値として意味を成さん。
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new Error(`--extend-below は 0〜1: ${value}`);
  return ratio;
};

type RunArgs = {
  arm: string;
  run: string;
  scriptName: string;
  characters: ScriptCharacter[];
  mechanicsPhase?: ScenePhase;
  turnsLimit?: number;
  extendBelowRatio?: number;
  dropMinChars: boolean;
  characterId?: string;
  actorMode: boolean;
  date: string;
};

const readRunArgs = (args: string[]): RunArgs => {
  const run = readArg(args, "--run");
  if (!run) throw new Error("script-run: --run <n> が要る（出力ディレクトリ名に使う）");
  const scriptName = readArg(args, "--script") ?? "adult";
  // --only <ラベル>: 台本のうち 1 キャラだけ演じる（Sakura / Downer）。
  const only = readArg(args, "--only");
  const characters = scriptCharacters(scriptName).filter(
    (entry) => !only || entry.label.toLowerCase() === only.toLowerCase(),
  );
  if (characters.length === 0) throw new Error(`--only に合うキャラがおらん: ${only}`);
  return {
    arm: readArg(args, "--arm") ?? "v2",
    run,
    scriptName,
    characters,
    // 段分離アーム: 目安字数・penalty・extend だけを指定の段にする（お手本は台帳の段のまま）。
    mechanicsPhase: readMechanicsPhase(readArg(args, "--mechanics")),
    turnsLimit: readTurns(readArg(args, "--turns")),
    extendBelowRatio: readExtendBelow(readArg(args, "--extend-below")),
    dropMinChars: args.includes("--no-min-length"),
    characterId: readArg(args, "--character-id"),
    actorMode: readArg(args, "--mode") === "actor",
    date: readArg(args, "--date") ?? new Date().toISOString().slice(0, 10),
  };
};

// 俳優モデルは既定で Sakura と同じものを使う。V2_ACTOR_MODEL で差し替え可能
// （例: 俳優だけ安いモデルにして台詞生成の課金を抑える）。
const buildActor = (actorMode: boolean, model: BaseChatModel): UserActor | undefined => {
  if (!actorMode) return undefined;
  const actorModel =
    process.env.V2_FAKE_MODEL === "1" || !process.env.V2_ACTOR_MODEL
      ? model
      : createOpenRouterModel({ ...process.env, V2_MODEL: process.env.V2_ACTOR_MODEL });
  return createUserActor(actorModel);
};

const modeLabel = (actor: UserActor | undefined): string => (actor ? "actor" : "scripted");

const main = async (args: string[]): Promise<void> => {
  const {
    arm,
    run,
    scriptName,
    characters,
    mechanicsPhase,
    turnsLimit,
    extendBelowRatio,
    dropMinChars,
    characterId,
    actorMode,
    date,
  } = readRunArgs(args);
  const runId = String(process.hrtime.bigint()).slice(-8);
  const outDir = resolve(
    REPO_ROOT,
    `.work/e2e-results/vlong-dogfood/${outputDirName({ date, arm, run, runId })}`,
  );

  // モデルは出力ディレクトリを作る前に作る。キー無しはここで OpenRouterKeyMissingError で落ち、
  // 空のディレクトリを残さん。
  const model = createModel();
  mkdirSync(outDir, { recursive: true });
  // actor も同じモデルで演じる。俳優用に別モデルを変えたい時は
  // V2_ACTOR_MODEL=... で差し替える（両方 OpenRouter、課金は 2 系統になる）。
  const actor = buildActor(actorMode, model);
  const ctx: RunContext = {
    arm,
    run,
    runId,
    outDir,
    qualityLines: [],
    mechanicsPhase,
    turnsLimit,
    extendBelowRatio,
    dropMinChars,
    characterId,
    actor,
  };
  console.log(
    `arm=${arm} script=${scriptName} mode=${modeLabel(actor)} mechanics=${mechanicsPhase ?? "<ledger>"} ` +
      `extendBelow=${extendBelowRatio ?? EXTEND_BELOW_RATIO} noMinLength=${dropMinChars} ` +
      `turns=${turnsLimit ?? "<all>"} ` +
      `characterId=${characterId ?? "<script>"} run=${run} runId=${runId} model=${modelNameOf(model)} out=${outDir}`,
  );

  applyLocalMigrations();
  const { env, dispose } = await createPlatform();
  try {
    const db = createDb(env.DB);
    // 金を使う前に 2 体とも居ることを確かめる。
    for (const entry of characters) await resolveCharacter(db, entry);

    const results: SummaryRow[] = [];
    for (const entry of characters) {
      const records = await runCharacter(ctx, db, model, entry);
      results.push(
        ...records.map(
          ({
            character,
            turn,
            intent,
            servedPhase,
            mechanicsPhase: turnMechanicsPhase,
            visibleChars,
            innerChars,
            preExtendVisibleChars,
            model: servedModel,
            regenerated,
            extended,
            dropped,
            ending,
            latencyMs,
          }) => ({
            character,
            turn,
            intent,
            servedPhase,
            mechanicsPhase: turnMechanicsPhase,
            visibleChars,
            innerChars,
            preExtendVisibleChars,
            model: servedModel,
            regenerated,
            extended,
            dropped,
            ending,
            latencyMs,
          }),
        ),
      );
    }

    writeFileSync(
      resolve(outDir, `summary-session-${arm}-${run}-${runId}.json`),
      JSON.stringify(
        {
          mode: "session",
          arm,
          runId,
          script: scriptName,
          mechanicsPhase: mechanicsPhase ?? null,
          // どの閾値で撃ったかを run 単位で残す（extend 無効アームと通常アームを
          // 後から見分ける口。未指定時は engine 既定値）。
          extendBelowRatio: extendBelowRatio ?? EXTEND_BELOW_RATIO,
          // A3 再仕様アームの証跡（字数目標を外した run を summary から判別できる）。
          dropMinChars,
          results,
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(outDir, `quality-log-${arm}-${run}.txt`),
      ctx.qualityLines.join("\n") + (ctx.qualityLines.length > 0 ? "\n" : ""),
      "utf8",
    );
    console.log(`wrote ${results.length} turn(s) to ${outDir}`);
  } finally {
    await dispose();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
