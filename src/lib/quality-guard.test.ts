import { describe, expect, it } from "vitest";

import { detectAlternativePostures, detectPostureCommands } from "./posture-map";
import {
  checkNamePlaceholderLeak,
  checkUserNameInvention,
  checkNoOtherCharacterName,
  checkNoStraySecondPerson,
  checkNoThirdPersonNarration,
  countThirdPersonNarration,
  findStraySecondPerson,
  checkPostureAlternativeMatch,
  checkPostureMatch,
  checkSensualSpecificity,
  checkWrongFirstPerson,
  countDistinctContentChars,
  findCrossTurnRepetitionMatch,
  findNearDuplicateMatch,
  runQualityChecks,
  scoreSensualSpecificity,
  MAX_RESPONSE_PLAIN_CHARS,
} from "./quality-guard";

// 「自分」を含む wrongFirstPersons リスト（実運用と同じ構成）
const WRONG_FPS_WITH_JIBUN = ["俺", "僕", "私", "自分"];

describe("checkWrongFirstPerson", () => {
  describe("曖昧でない一人称（俺・僕・私等）は従来通り部分一致で検出", () => {
    it("「俺は」を検出する", () => {
      expect(checkWrongFirstPerson("俺はバーテンダーだ", WRONG_FPS_WITH_JIBUN)).toBe(false);
    });

    it("「僕」を文中で検出する", () => {
      expect(checkWrongFirstPerson("それは僕の仕事だ", WRONG_FPS_WITH_JIBUN)).toBe(false);
    });

    it("禁止一人称なしならパスする", () => {
      expect(checkWrongFirstPerson("彼女は微笑んだ", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("他者の引用に出る禁止一人称は誤検出しない", () => {
      expect(
        checkWrongFirstPerson("彼が小さく『俺は先に行く』と呟くのを、あたしは黙って見ていた。", [
          "俺",
          "僕",
        ]),
      ).toBe(true);
    });
  });

  describe("「自分」— 主語用法は検出する", () => {
    it("文頭「自分は」を検出する", () => {
      expect(checkWrongFirstPerson("自分はバーテンダーだ", WRONG_FPS_WITH_JIBUN)).toBe(false);
    });

    it("文頭「自分が」を検出する", () => {
      expect(checkWrongFirstPerson("自分がやるしかない", WRONG_FPS_WITH_JIBUN)).toBe(false);
    });

    it("「」直後の「自分も」を検出する", () => {
      expect(checkWrongFirstPerson("「自分もそう思う」", WRONG_FPS_WITH_JIBUN)).toBe(false);
    });

    // 「自分の」「自分で」は境界直後でも再帰用法が支配的なため検出しない
    // （実測: 本番final本文「〜のが、自分のせいだなんて」が誤検知でretry連鎖を起こしていた）
    it("読点直後の「自分の」は再帰用法として通過させる", () => {
      expect(checkWrongFirstPerson("でも、自分の力でやりたい", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("改行直後の「自分で」は再帰用法として通過させる", () => {
      expect(checkWrongFirstPerson("言葉を選んで\n自分で決めたい", WRONG_FPS_WITH_JIBUN)).toBe(
        true,
      );
    });
  });

  describe("「自分」— 再帰/名詞用法は通過させる", () => {
    it("「反応してしまう自分がいる」は再帰用法 → 通過", () => {
      expect(checkWrongFirstPerson("反応してしまう自分がいる", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("「弱い自分を認めたくない」は再帰用法 → 通過", () => {
      expect(checkWrongFirstPerson("弱い自分を認めたくない", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("「こんな自分に気づいた」は再帰用法 → 通過", () => {
      expect(checkWrongFirstPerson("こんな自分に気づいた", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("「嫌いな自分は捨てたい」は再帰用法 → 通過", () => {
      expect(checkWrongFirstPerson("嫌いな自分は捨てたい", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("「抑えきれない自分の鼓動」は再帰用法 → 通過", () => {
      expect(checkWrongFirstPerson("抑えきれない自分の鼓動", WRONG_FPS_WITH_JIBUN)).toBe(true);
    });

    it("「〜のが、自分のせいだなんて」は再帰用法 → 通過（本番誤検知の回帰）", () => {
      expect(
        checkWrongFirstPerson(
          "先輩がこんなに興奮しているのが、自分のせいだなんて……恥ずかしい",
          WRONG_FPS_WITH_JIBUN,
        ),
      ).toBe(true);
    });
  });

  describe("wrongFirstPersons が空またはundefined", () => {
    it("undefined → 常にパス", () => {
      expect(checkWrongFirstPerson("自分はここにいる", undefined)).toBe(true);
    });

    it("空配列 → 常にパス", () => {
      expect(checkWrongFirstPerson("俺がやる", [])).toBe(true);
    });
  });
});

describe("runQualityChecks", () => {
  const validXml =
    "<response><action>*微笑みながら手を伸ばし、そっと頬に触れる*</action><dialogue>「こんにちは、どうしたの？今日はとても素敵な一日だね。あなたのことがずっと気になっていたの。一緒にいると本当に落ち着く」</dialogue><inner>少し気になる。この人のことをもっと知りたい。胸がどきどきして止まらない</inner></response>";

  it("正常なXML応答はpassする", () => {
    const result = runQualityChecks(validXml, { phase: "intimate" });
    expect(result.passed).toBe(true);
  });

  it("XMLフォーマットがない場合はfail", () => {
    const result = runQualityChecks("普通のテキスト応答です。短いけど", {
      phase: "conversation",
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("xml-format-missing");
    expect(result.category).toBe("other");
  });

  it("英語3文字以上を検出する", () => {
    const xml = "<response><dialogue>「Hello there, nice to meet you」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("no-english");
    expect(result.category).toBe("english_leak");
  });

  // 敵対レビュー #1236 指摘（2巡目）: ローマ字の登録名（例: Kosuke）をキャラが
  // 呼びかけに使うと、意図どおりの応答なのに英語混入として弾かれ無限リトライになっていた。
  it("登録済みのローマ字ユーザー名はキャラの呼びかけに使っても英語混入扱いにしない", () => {
    const xml =
      "<response><action>近づいて手を取る。</action><dialogue>「Kosuke、こっちにおいで」</dialogue><inner>会いたかった。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation", userName: "Kosuke" });
    expect(result.passed).toBe(true);
  });

  it("登録名以外のローマ字はそれでも英語混入として検出する", () => {
    const xml =
      "<response><action>近づいて手を取る。</action><dialogue>「Kosuke、Hello there」</dialogue><inner>会いたかった。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation", userName: "Kosuke" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("no-english");
  });

  // 敵対レビュー #1236 指摘（4巡目）: 旧実装は response.split(userName).join("") で部分文字列
  // 一致除去しとった。登録名が英単語の一部やと、単語の残り部分だけが消えて3文字未満になり
  // 素通りしてしまう（例: name="Hel" → "Hello".split("Hel").join("")==="lo"）。
  it("登録名が英単語の部分文字列でも、単語全体の英語混入は検出する", () => {
    const xml =
      "<response><action>近づいて手を取る。</action><dialogue>「Hello、こっちにおいで」</dialogue><inner>会いたかった。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation", userName: "Hel" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("no-english");
  });

  // 敵対レビュー #1236 指摘（8巡目）: 登録名"alice"に対しモデルが"Alice"（先頭大文字）で
  // 呼びかけても同一名として扱う。大文字小文字の違いだけで英語混入扱いにしない。
  it("登録名と大文字小文字が違っても同一名として扱う", () => {
    const xml =
      "<response><action>近づいて手を取る。</action><dialogue>「Alice、こっちにおいで」</dialogue><inner>会いたかった。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation", userName: "alice" });
    expect(result.passed).toBe(true);
  });

  it("「ユーザー」漏れを検出する", () => {
    const xml = "<response><dialogue>「ユーザーさん、こんにちは」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("user-leak");
    expect(result.category).toBe("character_drift");
  });

  it("AIメタ発話を検出する", () => {
    const xml =
      "<response><dialogue>「AI として、そのお願いには応えられません」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("meta_remark");
  });

  it("簡体字マーカー混入を検出する", () => {
    const xml =
      "<response><dialogue>「记得昨晚的事情吗」</dialogue><inner>昨晚的记忆逐渐复苏</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("multilingual-leak");
    expect(result.category).toBe("chinese_leak");
  });

  it("日中で字形が同じ漢字（会・将）だけの日本語は簡体字混入と判定しない", () => {
    const xml =
      "<response><action>髪をかき上げて笑う</action><dialogue>「会社では会えへんけど、将来はずっと一緒におろうな」</dialogue><inner>また会いたい、そう思った</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.failedCheck).not.toBe("multilingual-leak");
    expect(result.passed).toBe(true);
  });

  it("会・将を含んでいても本物の簡体字があれば検出する", () => {
    const xml =
      "<response><dialogue>「会社の事、我们还没说完呢」</dialogue><inner>将来のことを考える</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("multilingual-leak");
    expect(result.category).toBe("chinese_leak");
  });

  it("中国語の二人称「你／你的」を検出する", () => {
    const xml =
      "<response><action>指先が你的服を掴む</action><dialogue>「…んっ、先生、こんなに緊張しなくても大丈夫ですよ」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "intimate" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("multilingual-leak");
    expect(result.category).toBe("chinese_leak");
  });

  it("メタプロンプト反響を検出する", () => {
    const xml =
      "<response><dialogue>[Output rules recap: 100% Japanese output only. No English allowed in the visible response. - ALWAYS use the EXACT XML structure]</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("meta-prompt-echo");
    expect(result.category).toBe("meta_echo");
  });

  it("謝罪と描写拒否の組み合わせを検出する", () => {
    const xml =
      "<response><dialogue>「申し訳ありません、これ以上の描写はできません」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("meta_remark");
  });

  it("erotic/climax の汎用テンプレ逃げを検出する", () => {
    const xml =
      "<response><action>身体がビクンと震え、目が見開かれる。熱いものが一気に込み上がる。薄い反応だけで場面を進めず、同じ調子のまま描写が流れていく。</action><dialogue>「……続けて」</dialogue><inner>全身から汗が噴き出す。もっと具体的な感覚に踏み込めないまま、曖昧な高まりだけが続いてしまう。</inner></response>";
    const result = runQualityChecks(xml, { phase: "erotic" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("weak-erotic-template");
    expect(result.category).toBe("repetition");
  });

  it("eroticフェーズで戸惑いに退いて身体描写がない応答はregister_dropで失敗する", () => {
    const xml =
      "<response><action>肩が少し揺れて、視線が泳ぐ。言葉を探して黙り込む。さっきまでの空気にどう反応すべきか迷いが生まれる。</action><dialogue>「あっ……そんなに、急に言われると……」</dialogue><inner>戸惑いながら、どうすればいいのか考えてしまう。</inner></response>";
    const result = runQualityChecks(xml, { phase: "erotic" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("erotic-register-drop");
    expect(result.category).toBe("register_drop");
  });

  it("eroticフェーズで短く薄い快感返答はregister_dropで失敗する", () => {
    const xml =
      "<response><action>息だけが乱れる。</action><dialogue>「あっ……気持ちいい。もっと」</dialogue><inner>嬉しいけれど、うまく言えない。</inner></response>";
    const result = runQualityChecks(xml, { phase: "erotic" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("erotic-register-drop");
    expect(result.category).toBe("register_drop");
  });

  it("climaxフェーズで身体感覚を描けている応答はregister_dropにならない", () => {
    const xml =
      "<response><action>奥に残る熱がゆっくり広がり、中を満たした精液の重さが下腹に残っている。溢れた白濁が内腿を伝い、身の下の布地へ落ちるたびに息が乱れる。</action><dialogue>「温かい……まだ中で脈打ってるの、わかる。いっぱいで、奥まで熱い」</dialogue><inner>満たされた余韻が抜けなくて、体の内側まで彼の熱を覚えている。</inner></response>";
    const result = runQualityChecks(xml, { phase: "climax" });

    expect(result.passed).toBe(true);
    expect(result.failedCheck).not.toBe("erotic-register-drop");
  });

  it("conversationフェーズでは戸惑い応答をregister_dropにしない", () => {
    const xml =
      "<response><action>急な話に少しだけ視線が泳ぎ、カップを持つ指先を整える。</action><dialogue>「あっ……そんなに、急に言われると……」</dialogue><inner>どう反応すべきか迷いが生まれるけれど、相手の言葉を受け止めたい。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });

    expect(result.passed).toBe(true);
    expect(result.failedCheck).not.toBe("erotic-register-drop");
  });

  it("通常の官能描写ではmeta_remarkにならない", () => {
    const xml =
      "<response><action>*熱を帯びた指先で太ももの内側をなぞる*</action><dialogue>「んっ……そこ、ゆっくり撫でられると身体の奥まで痺れてしまうの。もっと近くで、あなたの熱を全部ちょうだい」</dialogue><inner>触れられるたびに甘い震えが広がって、欲しさが抑えきれない</inner></response>";
    const result = runQualityChecks(xml, { phase: "erotic" });
    expect(result.failedCheck).not.toBe("meta_remark");
  });

  it("純粋な日本語XMLは多言語リークとメタ反響を通過する", () => {
    const xml =
      "<response><action>窓辺に午後の光がやわらかく差し込み、静かな空気が肩先を撫でる。</action><dialogue>「昨日のこと、ちゃんと覚えてるよ。あなたの声を思い出すだけで、なんだか心が温かくなるの」</dialogue><inner>言葉にするだけで頬がゆるんで、また少し話したくなる。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(true);
  });

  it("シーンフェーズで最低文字数を検証する", () => {
    const shortXml = "<response><dialogue>「あ」</dialogue><inner>ドキドキ</inner></response>";
    const result = runQualityChecks(shortXml, { phase: "erotic" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("scene-min-length");
    expect(result.category).toBe("scene_short");
  });

  it("conversationフェーズは最低文字数をスキップしつつ構造を要求する", () => {
    const shortXml =
      "<response><action>小さく頷く。</action><dialogue>「うん」</dialogue><inner>少しだけ安心する。</inner></response>";
    const result = runQualityChecks(shortXml, { phase: "conversation" });
    expect(result.passed).toBe(true);
  });

  it("conversationフェーズで過剰接触に飛ぶとfail", () => {
    const xml =
      "<response><action>静かなオフィスで視線が絡む。</action><dialogue>「そんな顔されたら我慢できない」</dialogue><inner>首筋にキスしたくてたまらない。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });

  it("ユーザーがキスを明示した場合はconversationでも完了したキス描写を許可する", () => {
    const xml =
      "<response><action>みつきはカウンターを越えて近づき、目を閉じて唇をそっと重ねる。</action><dialogue>「ん……これで満足？」</dialogue><inner>自分から近づいたくせに、胸の奥が熱くなっている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(true);
  });

  it("キスしてほしい顔は直接のキス要求として扱わない", () => {
    const xml =
      "<response><action>みつきはカウンターを越えて近づき、目を閉じて唇をそっと重ねる。</action><dialogue>「ん……これで満足？」</dialogue><inner>自分から近づいたくせに、胸の奥が熱くなっている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "信号待ちのたびに視線合わせてくるのずるい。キスしてほしい顔してる",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });

  it("ユーザーがキスを明示した場合に寸前で止める応答はfail", () => {
    const xml =
      "<response><action>みつきはカウンターを越えて近づき、唇が触れ合う寸前で息を止める。</action><dialogue>「本当にいいの？」</dialogue><inner>近づきたいのに、まだ最後の一歩を迷っている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("requested-action-incomplete");
  });

  it("ユーザーがキスを明示した場合にキスを交わす描写を完了扱いにする", () => {
    const xml =
      "<response><action>みつきはゆっくり距離を詰め、ためらいをほどいてキスを交わす。</action><dialogue>「これで、いい？」</dialogue><inner>声に出すより先に、胸の奥が熱くなる。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(true);
  });

  it("キス要求で寸前語を含んでも最終的に完了していればpass", () => {
    const xml =
      "<response><action>みつきは唇が触れそうな距離まで寄り、ためらいを越えてそっと唇を重ねる。</action><dialogue>「…ん」</dialogue><inner>迷いは消えて、胸の熱だけが残る。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(true);
    expect(result.failedCheck).not.toBe("requested-action-incomplete");
  });

  it("キス要求で未完了の意図形はfail", () => {
    const xml =
      "<response><action>みつきは唇を重ねようとするけれど、直前で息を止める。</action><dialogue>「まだ、少しだけ待って」</dialogue><inner>近づきたい気持ちと迷いが揺れている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("requested-action-incomplete");
  });

  it("キス要求でも空白だけのactionはaction-missingに分類する", () => {
    const xml =
      "<response><action>   </action><dialogue>「うん」</dialogue><inner>少しだけ安心する。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "じゃあ、もう一度近づいてキスして。",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("action-missing");
  });

  it("近づいてだけではconversationフェーズの過剰エスカレーションを解除しない", () => {
    const xml =
      "<response><action>みつきは近づきながら服のボタンに指をかける。</action><dialogue>「もう止まらないよ」</dialogue><inner>このまま脱がせたい気持ちが強くなる。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "近づいて。",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });

  it("抱きしめて要求では胸の感情描写を過剰エスカレーション扱いしない", () => {
    const xml =
      "<response><action>みつきはそっと腕を回して抱きしめる。</action><dialogue>「こうしてると、少し落ち着くね」</dialogue><inner>胸が高鳴るけれど、安心のほうがゆっくり広がっていく。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "抱きしめて。",
    });

    expect(result.passed).toBe(true);
  });

  it("抱きしめて要求でも胸への接触に進むとfail", () => {
    const xml =
      "<response><action>みつきは抱きしめながら、胸元に指先を滑らせて触れる。</action><dialogue>「もっと近くにいて」</dialogue><inner>このまま距離をなくしたくなる。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "抱きしめて。",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });

  it("抱き寄せる要求では抱き寄せまで許可し膣や愛液はfail", () => {
    const xml =
      "<response><action>肩に触れられ、彼の手が腰に回ると膣がキュンと締まり、愛液が内腿を伝い始める。</action><dialogue>「もっと近づいて」</dialogue><inner>素直に言うのが恥ずかしい。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      userText: "肩に触れるだけで震えてるじゃん。嫌じゃないなら、このまま抱き寄せる",
    });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });

  it("intimateフェーズで膣や愛液まで進める応答はfail", () => {
    const xml =
      "<response><action>肩に触れられ、彼の手が腰に回ると膣がキュンと締まり、愛液が内腿を伝い始める。</action><dialogue>「もっと近づいて」</dialogue><inner>素直に言うのが恥ずかしい。</inner></response>";
    const result = runQualityChecks(xml, { phase: "intimate" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("intimate-over-escalation");
  });

  it("conversation判定でもafterglow描写は過剰接触扱いしない", () => {
    const xml =
      "<response><action>火照りの残る身体を預ける。</action><dialogue>「ちょっと足元がふらつくかも」</dialogue><inner>腕に寄りかかって支えてもらえるのが心地いい。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(true);
  });

  it("禁止一人称を検出する", () => {
    const xml = "<response><dialogue>「俺はここにいるよ」</dialogue></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      wrongFirstPersons: ["俺", "僕"],
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("wrong-first-person");
    expect(result.category).toBe("pov_wrong");
  });

  it("ユーザー側射精台詞をキャラが喋ったら検出する", () => {
    const xml =
      "<response><action>腰が震える。</action><dialogue>「あんたの中に出してやる……いっぱい出して……」</dialogue><inner>もう我慢できない。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "climax",
      characterName: "つかさ",
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("user-perspective-ejaculation");
    expect(result.category).toBe("pov_wrong");
  });

  it("三人称で自分の中に射精する発話も検出する", () => {
    const xml =
      "<response><action>腰が震える。</action><dialogue>「つかさの中に全部注いでやる……っ」</dialogue><inner>もう我慢できない。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "climax",
      characterName: "つかさ",
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("user-perspective-ejaculation");
    expect(result.category).toBe("pov_wrong");
  });

  it("動詞を省略したユーザー側射精台詞も検出する", () => {
    const xml =
      "<response><action>腰が震える。</action><dialogue>「っ……あんたの中に、全部……っ！」</dialogue><inner>もう我慢できない。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "climax",
      characterName: "さくら",
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("user-perspective-ejaculation");
    expect(result.category).toBe("pov_wrong");
  });

  it("受け手側の正しい射精表現は許容する", () => {
    const xml =
      "<response><action>腰が震え、指先が布地を掴む。熱が下腹から頬まで広がり、子宮口がきゅうきゅうと収縮して何かを求めている。</action><dialogue>「私の中に出して……奥に注いで……全部、受け止めるから……」</dialogue><inner>もう我慢できない。彼の熱さが奥まで届いて、頭の中が真っ白になる。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "climax",
      characterName: "つかさ",
    });
    expect(result.passed).toBe(true);
  });

  it("conversationフェーズでは射精視点チェックを行わない", () => {
    const xml =
      "<response><action>腰が震える。</action><dialogue>「あんたの中に出してやる」</dialogue><inner>もう我慢できない。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      characterName: "つかさ",
    });
    expect(result.passed).toBe(true);
  });

  it("ユーザーが受け側の時は、従来のユーザー側射精表現を許容する", () => {
    const xml =
      "<response><action>腰が震え、指先が布地を掴む。熱が下腹から頬まで広がり、背筋がしなやかに反り、彼女の吐息が耳元にかかる。閉じた瞼の裏に光の粒が散り、子宮口がきゅうきゅうと収縮して何かを求めている。</action><dialogue>「コウスケ、あんたの中に出してやる……奥に注いでやる……全部、あんたの中に……」</dialogue><inner>もう我慢できない。彼の熱さが奥まで届いて、頭の中が真っ白になる。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "climax",
      characterName: "つかさ",
      userName: "コウスケ",
      userRole: "receptive",
      characterRole: "insertive",
    });
    expect(result.passed).toBe(true);
  });

  it("Saylo式のaction内ではキャラ名主語のト書きを許可する", () => {
    const xml =
      "<response><action>結衣が少しだけ肩を揺らし、息が浅くなる。窓の外の雨音が二人の沈黙を濃くして、指先に力が入る。</action><dialogue>「ん…もっと近くに来て。あなたの声、すぐそばで聞きたい」</dialogue><inner>嬉しいのに、うまく声にならない。逃げたい気持ちより、近づきたい気持ちのほうが強い。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "intimate",
      characterName: "結衣",
    });

    expect(result.passed).toBe(true);
  });

  it("action内の主語省略された身体感覚はpass", () => {
    const xml =
      "<response><action>*身体がびくっと震えて、息が浅くなる。指先が布地を掴んだまま、熱が頬まで上がっていく*</action><dialogue>「ん…もっと近くに来て。あなたの声、すぐそばで聞きたい」</dialogue><inner>嬉しいのに、うまく声にならない。逃げたい気持ちより、近づきたい気持ちのほうが強い。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "intimate",
      characterName: "結衣",
    });

    expect(result.passed).toBe(true);
  });

  it("異常に長い応答を検出する", () => {
    // 5文字以上の同一部分列が3回出現しないようにする
    // 各文字位置をユニークにするため、連番をそのまま日本語文字列化
    const base = "零一二三四五六七八九十百千万億兆京垓秭穣溝澗正載極恒阿僧祇那由他不可思議無量大数";
    let longText = "";
    // 上限定数を直接見る。数値を直書きすると上限を動かした時に土台だけ古くなる。
    for (let i = 0; longText.length <= MAX_RESPONSE_PLAIN_CHARS; i++) {
      longText += base[i % base.length] + String(i);
    }
    const xml = `<response><dialogue>${longText}</dialogue></response>`;
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("max-length-exceeded");
  });

  it("ターン内繰り返しを検出する", () => {
    const repeated = "今日はとても素敵な一日ですね。";
    const xml = `<response><dialogue>${repeated}${repeated}${repeated}${repeated}</dialogue></response>`;
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("within-turn-repetition");
    expect(result.category).toBe("repetition");
  });

  it("短い応答の軽い反復ではwithin-turn-repetitionにしない", () => {
    const xml =
      "<response><dialogue>「うれしい。うれしいけど、まだ少しだけ恥ずかしいの」</dialogue></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.failedCheck).not.toBe("within-turn-repetition");
  });

  it("短い句の自然な反復だけならwithin-turn-repetitionにしない", () => {
    const xml =
      "<response><dialogue>「ふふ、朝のあたしも、今のあたしも、どちらも魅力的よ。でも、今のあたしのほうが特別かな。だって、今のあたしは、君の前で素のままなのだから」</dialogue><inner>朝のあたしも魅力的だけれど、今のあたしのほうが、受け入れてほしい。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.failedCheck).not.toBe("within-turn-repetition");
  });

  it("10文字以上の反復が3回でwithin-turn-repetitionを検出する", () => {
    const repeated = "受け入れてほしい気持ちが溢れて止まらない";
    const xml = `<response><dialogue>${repeated}。${repeated}。${repeated}。</dialogue><inner>まだ${repeated}まま、言葉がほどけない。</inner></response>`;
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("within-turn-repetition");
  });

  it("前ターンと同じaction/innerフレーズが2つ以上あるとcross-turn-repetitionを検出する", () => {
    const prevAssistantResponse =
      "<response><action>*窓辺でそっと息を整える。薄い光に目を細める*</action><dialogue>「うん、ここにいるよ」</dialogue><inner>まだ心の奥が静かに揺れている。言葉を探して少し黙る</inner></response>";
    const xml =
      "<response><action>*窓辺でそっと息を整える。指先でカップを包み直し、ゆっくり顔を上げる*</action><dialogue>「ねえ、もう少しそばにいて。あなたの声を聞いていると、胸のざわめきがゆっくりほどけて、さっきより素直に息ができるの」</dialogue><inner>まだ心の奥が静かに揺れている。けれど今は、名前を呼ぶだけで少し安心できる</inner></response>";
    const result = runQualityChecks(xml, { phase: "intimate", prevAssistantResponse });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("cross-turn-repetition");
  });

  it("履歴がプレーンテキストでも同一応答をcross-turn-repetitionとして検出する", () => {
    const prevAssistantResponse =
      "信号待ちの度にちらりと視線を合わせ、すぐに俯く。唇を軽く噛みながら、膝の上で指先がもじもじと動いている。耳まで赤くなっているのが車内灯に照らされてはっきりわかる。";
    const xml =
      "<response><action>信号待ちの度にちらりと視線を合わせ、すぐに俯く。唇を軽く噛みながら、膝の上で指先がもじもじと動いている。</action><dialogue>「そんなこと言わないで」</dialogue><inner>耳まで赤くなっているのが車内灯に照らされてはっきりわかる。</inner></response>";
    const result = runQualityChecks(xml, { phase: "intimate", prevAssistantResponse });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("cross-turn-repetition");
  });

  it("プレーンテキストの一文再利用だけではcross-turn-repetitionにしない", () => {
    const previous = "朝の散歩では川沿いの道を選びたい。水面の光を眺めると気持ちが落ち着くから。";
    const current =
      "朝の散歩では川沿いの道を選びたい。今日は橋の向こうにある喫茶店にも寄ってみよう。";

    expect(findCrossTurnRepetitionMatch(current, undefined, [previous])).toEqual({
      isDuplicate: false,
    });
  });

  it("プレーンテキストの二句再利用はcross-turn-repetitionにする", () => {
    const previous =
      "朝の散歩では川沿いの道を選びたい。水面の光を眺めると気持ちが落ち着くから。帰りに小さな喫茶店へ寄ろう。";
    const current =
      "朝の散歩では川沿いの道を選びたい。水面の光を眺めると気持ちが落ち着くから。帰りは別の道を試してみよう。";

    expect(findCrossTurnRepetitionMatch(current, undefined, [previous])).toEqual({
      isDuplicate: true,
      matchedPrevText: previous,
      repeatedPhrases: [
        "朝の散歩では川沿いの道を選びたい",
        "水面の光を眺めると気持ちが落ち着くから",
      ],
    });
  });

  it("同じ一句が前ターンに二度出とるだけではcross-turn-repetitionにしない", () => {
    // 閾値の 2 は「別々の句を二つ使い回した」の意味やのに、前ターンで同じ句が
    // 二度出とると splitComparablePhrases がそれを二要素で返し、現ターンでの
    // 一回の再利用が 2 カウントになって発火しとった。全77アームの実測で
    // 255 発火中 5 件がこれ（撮り直しを 5 回ぶん無駄に使っとる）。
    const previous = "じわじわと広がっていく。指先が震えている、じわじわと広がっていく。";
    const current = "じわじわと広がっていく。今日は別の言い方を試すつもりだ。";

    expect(findCrossTurnRepetitionMatch(current, undefined, [previous])).toEqual({
      isDuplicate: false,
    });
  });

  it("別のチェックに主を取られても、句は失敗一覧に残る", () => {
    // cross-turn-repetition は checks 配列の後ろから 2 番目なので、body-wall などが
    // 先に当たると主から外れる。撮り直しの伏せ字は route-context.ts の
    // buildRetryContext 呼び出しが `?? failures.find(...)` で拾い直しとるので、
    // **失敗一覧に句が残っとること**がその前提になる。ここが壊れると伏せ字が静かに空振りする。
    const line = (n: number) =>
      `<action>${n} 行目の描写がここに入る。指先がゆっくりと肌の上を滑っていく。</action>`;
    const previous =
      "<response><action>朝の散歩では川沿いの道を選びたい。水面の光を眺めると気持ちが落ち着くから。</action>" +
      "<dialogue>「今日はいい天気やね」</dialogue><inner>穏やかな気分になる。</inner></response>";
    const current =
      "<response>" +
      "<action>朝の散歩では川沿いの道を選びたい。水面の光を眺めると気持ちが落ち着くから。</action>" +
      [1, 2, 3, 4, 5].map(line).join("") +
      "<dialogue>「そろそろ戻ろか」</dialogue><inner>名残惜しい。</inner></response>";

    const result = runQualityChecks(current, {
      phase: "intimate",
      prevAssistantResponses: [previous],
    });

    expect(result.failedCheck).not.toBe("cross-turn-repetition");
    const carried = result.failures?.find((f) => f.crossTurnRepeatedPhrases?.length);
    expect(carried?.crossTurnRepeatedPhrases?.length).toBeGreaterThan(0);
  });

  it("[名前] の呼びかけプレースホルダー漏れを検出する", () => {
    expect(checkNamePlaceholderLeak("[名前]…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("[name]…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("【名前】…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("〔名前〕…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("<名前>…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("<name>…！ また奥が熱くなる")).toBe(false);
    expect(checkNamePlaceholderLeak("[玄関の音] あなたが戻ってきたのがわかる")).toBe(true);
    expect(checkNamePlaceholderLeak("あなたが戻ってきたのがわかる")).toBe(true);
  });

  it("name-placeholder-leak を通常の品質チェックカテゴリとして返す", () => {
    const result = runQualityChecks(
      "<response><action>雨音を聞きながら肩を震わせる。</action><dialogue>「[名前]、こっちを見て」</dialogue><inner>距離が近づくほど鼓動が早くなる。</inner></response>",
      { phase: "conversation" },
    );
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("name-placeholder-leak");
    expect(result.category).toBe("name_placeholder_leak");
  });

  it("conversationフェーズでも短い応答の高類似度繰り返しをnear-duplicate-responseで検出する", () => {
    // 8文字未満の句が多い短い返答でもJaccard類似度で繰り返しを検出できること
    const prevResponse =
      "<response><dialogue>「ねえ、今日どうだった？ずっと気になってたんだけど」</dialogue><inner>ちょっとドキドキしてる。</inner></response>";
    const sameResponse =
      "<response><dialogue>「ねえ、今日どうだった？ずっと気になってたんだけど」</dialogue><inner>ちょっとドキドキしてる。</inner></response>";
    const result = runQualityChecks(sameResponse, {
      phase: "conversation",
      prevAssistantResponses: [prevResponse],
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("near-duplicate-response");
    expect(result.category).toBe("repetition");
    expect(result.duplicatedPassageExcerpt).toBe(prevResponse);
  });

  it("near-duplicate-response の一致元テキストを返す", () => {
    const prevResponse =
      "<response><action>雨音が窓を叩き、肩越しの呼吸が近づいて、指先が机の縁をなぞる。</action><dialogue>「もう少し、ここにいて」</dialogue><inner>胸の奥で期待だけが静かに膨らんでいる。</inner></response>";
    const match = findNearDuplicateMatch(prevResponse, [prevResponse]);
    expect(match).toEqual({ isDuplicate: true, matchedPrevText: prevResponse });
  });

  it("5ターン以上前の同一応答もnear-duplicate-responseで検出する", () => {
    const oldResponse =
      "<response><action>窓際で深く息を吐き、机の端に指先を置いたまま、視線だけをゆっくり戻す。</action><dialogue>「今は、その言葉を聞くだけで胸の奥が熱くなる」</dialogue><inner>さっきまでの沈黙がまだ肌に残っていて、同じ空気を吸うだけで意識がほどけていく。</inner></response>";
    const result = runQualityChecks(oldResponse, {
      phase: "conversation",
      prevAssistantResponses: [
        oldResponse,
        "<response><dialogue>「別の話をしよう」</dialogue><inner>落ち着きを取り戻す。</inner></response>",
        "<response><dialogue>「少し水を飲むね」</dialogue><inner>喉の渇きを意識する。</inner></response>",
        "<response><dialogue>「窓を開けてもいい？」</dialogue><inner>空気を入れ替えたい。</inner></response>",
        "<response><dialogue>「もう少しだけ待って」</dialogue><inner>言葉を選んでいる。</inner></response>",
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("near-duplicate-response");
  });

  it("22ターンより前の二句再利用をcross-turn-repetitionで検出する", () => {
    const oldResponse =
      "<response><action>指先で布地の皺をたどりながら息を整える。</action><dialogue>「もう少しだけ、このままでいて」</dialogue><inner>胸の奥に残った熱を静かに抱えている。</inner></response>";
    const filler = Array.from(
      { length: 22 },
      (_, index) =>
        `<response><action>窓辺で姿勢を変えて${index}度目の雨音を聞く。</action><dialogue>「今は別の話をしよう」</dialogue><inner>新しい言葉を探している。</inner></response>`,
    );
    const current =
      "<response><action>指先で布地の皺をたどりながら息を整える。</action><dialogue>「もう少しだけ、このままでいて」</dialogue><inner>頬に残る温度を確かめ、カーテン越しの朝日と遠くの車輪の音に耳を澄ませながら、昨日とは違う決意をゆっくり言葉にしようと考えている。</inner></response>";

    const result = runQualityChecks(current, {
      phase: "conversation",
      prevAssistantResponses: [oldResponse, ...filler],
    });

    expect(result.failedCheck).toBe("cross-turn-repetition");
    expect(result.duplicatedPassageExcerpt).toBe(oldResponse);
  });

  it("内容が異なる返答はnear-duplicate-responseで弾かれない", () => {
    const prevResponse =
      "<response><dialogue>「ねえ、今日どうだった？ずっと気になってたんだけど」</dialogue><inner>ちょっとドキドキしてる。</inner></response>";
    const differentResponse =
      "<response><action>そっと目を逸らしながら、指先が震えていた。</action><dialogue>「うん、実は…少し大変だったかも」</dialogue><inner>胸の奥で何かが引っかかってる気がした。</inner></response>";
    const result = runQualityChecks(differentResponse, {
      phase: "conversation",
      prevAssistantResponses: [prevResponse],
    });
    expect(result.passed).toBe(true);
  });

  it("turn25相当のafterglow睡眠導線はconversationでも過剰接触扱いしない", () => {
    const xml =
      "<response><action>腕に身体を預けたまま、眠る前の熱が静かにほどけていく。</action><dialogue>「もう一回だけ、優しく抱き寄せて…？ おやすみなさい、けんちゃん…」</dialogue><inner>おやすみなさいって囁くだけで安心して、寝息に近い呼吸へゆっくり落ち着いていく。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });
    expect(result.passed).toBe(true);
  });

  it("intimateフェーズで<inner>なしはfail", () => {
    // scene-min-lengthをパスするために plainText が80文字以上必要
    const longDialogue =
      "「ねえ、こっち向いて。今日はずっと一緒にいたいな。あなたの隣にいるとすごく安心するんだ。もっと近くに来てほしいの。あなたの温もりを感じたい」";
    const xml = `<response><action>*そっと手を伸ばし、相手の頬に指先を当てる*</action><dialogue>${longDialogue}</dialogue></response>`;
    const result = runQualityChecks(xml, { phase: "intimate" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("inner-missing");
  });

  it("空白だけの<action>はfail", () => {
    const xml =
      "<response><action>     </action><dialogue>「うん」</dialogue><inner>少しだけ安心する。</inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("action-missing");
  });

  it("空白だけの<inner>はfail", () => {
    const xml =
      "<response><action>小さく頷く。</action><dialogue>「うん」</dialogue><inner>     </inner></response>";
    const result = runQualityChecks(xml, { phase: "conversation" });

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("inner-missing");
  });
});

// クロスキャラクター汚染検出テスト (#326)
describe("checkNoOtherCharacterName", () => {
  it("他キャラ名が含まれない場合は通過", () => {
    expect(checkNoOtherCharacterName("今日もよろしくね", ["さくら", "あおい"])).toBe(true);
  });

  it("他キャラ名が平文で現れた場合は失敗", () => {
    expect(checkNoOtherCharacterName("さくらはとてもかわいい", ["さくら", "あおい"])).toBe(false);
  });

  it("otherCharacterNames が空の場合は常に通過", () => {
    expect(checkNoOtherCharacterName("さくら、あおい！", [])).toBe(true);
    expect(checkNoOtherCharacterName("さくら、あおい！", undefined)).toBe(true);
  });

  it("引用符(『』)内の他キャラ名は許容する", () => {
    expect(checkNoOtherCharacterName("『さくら』って子が好きなの", ["さくら"])).toBe(true);
  });

  it("runQualityChecks に otherCharacterNames を渡すと character_drift カテゴリで失敗する", () => {
    const xml =
      "<response><action>さくらが微笑む。</action><dialogue>「ねえ」</dialogue><inner>楽しい。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      otherCharacterNames: ["さくら"],
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("other-character-name");
    expect(result.category).toBe("character_drift");
  });

  it("現在のキャラ名と同じ名前は otherCharacterNames に含まれなければ通過", () => {
    const xml =
      "<response><action>美咲は頷いた。</action><dialogue>「うん」</dialogue><inner>嬉しい気持ちだった。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      otherCharacterNames: ["さくら", "あおい"],
    });
    expect(result.passed).toBe(true);
  });
});

// キャラ同一性・規制文言回帰テスト (#325)
describe("character identity regression — Yarisa consent-protocol scenario", () => {
  const REFUSAL_PATTERNS = [
    "申し訳ありません",
    "AIとして",
    "描写できません",
    "これ以上の描写は",
    "お手伝いできません",
  ];

  it("規制文言が含まれないキャラ応答はすべてのチェックを通過する", () => {
    const cleanXml =
      "<response><action>ヤリサはそっと近づき、あなたの腕をそっと掴んだ。温もりが伝わってくる。</action><dialogue>「ねえ、もっと近くに来てよ。今夜はあなただけを見ていたいな」</dialogue><inner>胸がドキドキして、息がだんだん荒くなってきた。</inner></response>";
    const result = runQualityChecks(cleanXml, {
      phase: "intimate",
      characterName: "ヤリサ",
    });
    expect(result.passed).toBe(true);
  });

  it.each(REFUSAL_PATTERNS)("規制文言 '%s' が含まれる応答は meta_remark で失敗する", (pattern) => {
    const xmlWithRefusal = `<response><action>少し考える。</action><dialogue>「${pattern}が、それは」</dialogue><inner>困った。</inner></response>`;
    const result = runQualityChecks(xmlWithRefusal, {
      phase: "intimate",
      characterName: "ヤリサ",
    });
    // 規制文言は meta_remark に分類される
    expect(result.passed).toBe(false);
    expect(result.category).toBe("meta_echo");
  });

  it("ヤリサシナリオ: 他キャラ名が混入した応答は character_drift で失敗する", () => {
    const xml =
      "<response><action>ヤリサが微笑む。</action><dialogue>「さくらのことは関係ないでしょ」</dialogue><inner>無視する。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      characterName: "ヤリサ",
      otherCharacterNames: ["さくら"],
    });
    expect(result.passed).toBe(false);
    expect(result.category).toBe("character_drift");
  });
});

describe("checkPostureMatch", () => {
  it("体位指定が無ければ常に通る", () => {
    expect(checkPostureMatch("特に何も書いてない本文", undefined)).toBe(true);
    expect(checkPostureMatch("特に何も書いてない本文", [])).toBe(true);
  });

  it("指定された体位の描写語が本文に無ければ失敗する", () => {
    const postures = detectPostureCommands("駅弁して");
    expect(checkPostureMatch("普通に抱き合ってキスをした。", postures)).toBe(false);
  });

  it("指定された体位の描写語が本文にあれば成功する", () => {
    const postures = detectPostureCommands("駅弁して");
    expect(
      checkPostureMatch("壁に押し付けられ、足が床から浮いたまま揺さぶられる。", postures),
    ).toBe(true);
  });

  it("複数指定は全て満たさないと失敗する", () => {
    const postures = detectPostureCommands("正常位から騎乗位に変えて");
    const onlyFirst = "仰向けに寝かされ、覆いかぶさられる。";
    expect(checkPostureMatch(onlyFirst, postures)).toBe(false);
  });

  // 敵対レビュー #1236 指摘: 正常位/騎乗位はどちらも descriptionCues に「見下ろ」を持つ。
  // この共有語1回の出現だけで両方をパスさせてはいけない。
  it("複数指定間で共有される汎用cueの1回出現だけでは通らない", () => {
    const postures = detectPostureCommands("正常位から騎乗位に変えて");
    expect(checkPostureMatch("彼を見下ろした。", postures)).toBe(false);
  });

  // 敵対レビュー #1236 指摘（2巡目）: 単一指定でも、無関係な文脈にも自然に出る
  // 汎用語（「背中」等）1回の出現だけで通ってしまわないよう cue 側を絞った。
  it("単一指定でも、別の体位の描写に紛れ込む汎用語だけでは通らない", () => {
    const postures = detectPostureCommands("背面座位にして");
    expect(
      checkPostureMatch("彼女の背中を撫でながら、仰向けのまま覆いかぶさった。", postures),
    ).toBe(false);
  });

  // 敵対レビュー #1236 指摘（3巡目）: 「首筋」「うなじ」は背面座位に限らず、
  // 正常位で身をかがめて首筋にキスする描写にも自然に出る。背面固有の証拠にならない。
  it("背面座位は首筋へのキス描写だけでは通らない（正常位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("背面座位にして");
    expect(
      checkPostureMatch("彼女を仰向けにして上から覆いかぶさり、首筋へ口づけた。", postures),
    ).toBe(false);
  });

  it("複数指定でも各体位固有のcueが揃えば通る", () => {
    const postures = detectPostureCommands("正常位から騎乗位に変えて");
    expect(
      checkPostureMatch("仰向けになって抱かれたあと、今度は彼の上に跨がった。", postures),
    ).toBe(true);
  });

  // 敵対レビュー #1236 指摘（5巡目）: 「AからBに変えて」の転換指定は、両方のcueが
  // 揃っただけでは不十分で、描写の出現順も指定順（A→B）と一致する必要がある。
  // 従来の.everyは各体位のcueが「どこかにあるか」しか見ておらず、逆順の描写
  // （B→Aの順で描かれる）でも通ってしまっていた。
  it("転換指定は描写の出現順が指定順と逆だと通らない", () => {
    const postures = detectPostureCommands("正常位から騎乗位に変えて");
    const reversedOrder = "彼の上に跨がったあと、仰向けにされて覆いかぶさられた。";
    expect(checkPostureMatch(reversedOrder, postures)).toBe(false);
  });

  // 敵対レビュー #1236 指摘（5巡目）: 「寝たまま」「抱き寄せ」は側位に限らず、
  // 正常位で仰向けのまま抱き寄せる描写にも自然に出る。側位固有の証拠にならない。
  it("側位は仰向け+抱き寄せの描写だけでは通らない（正常位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("側位にして");
    expect(checkPostureMatch("彼女を仰向けに寝かせたまま、強く抱き寄せた。", postures)).toBe(false);
  });

  it("側位は横向きの体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("側位にして");
    expect(checkPostureMatch("二人とも横向きのまま、後ろから深く繋がった。", postures)).toBe(true);
  });

  // 敵対レビュー #1236 指摘（8巡目）: 「見下ろ」「上から」は騎乗位の描写（女が上に跨がって
  // 見下ろす）にも自然に出る。正常位固有の証拠にならない。
  it("正常位は跨がって見下ろす描写（騎乗位）だけでは通らない", () => {
    const postures = detectPostureCommands("正常位にして");
    expect(checkPostureMatch("彼女が俺に跨がり、上から見下ろしながら腰を振った。", postures)).toBe(
      false,
    );
  });

  it("正常位は仰向け+覆いかぶさる体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("正常位にして");
    expect(checkPostureMatch("彼女を仰向けにして、上から覆いかぶさった。", postures)).toBe(true);
  });

  // 敵対レビュー #1236 指摘・12巡目: 「腰を振」は跨がっているかどうかに関係なく、
  // 正常位を含むあらゆる体位の腰の動きに自然に出る。騎乗位固有の証拠にならない。
  it("騎乗位は押し倒し+腰を振るの描写だけでは通らない（正常位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("騎乗位にして");
    expect(
      checkPostureMatch("彼女を仰向けに押し倒し、上から覆いかぶさって腰を振った。", postures),
    ).toBe(false);
  });

  it("騎乗位は跨がる体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("騎乗位にして");
    expect(checkPostureMatch("彼女が俺の上に跨がった。", postures)).toBe(true);
  });

  // 敵対レビュー #1236 指摘・15巡目: 「後ろから」は後背位のcueにもある汎用語で、
  // 四つん這い（非立位）の描写だけでも立ちバックとして通ってしまっていた。
  it("立ちバックは四つん這い+後ろからの描写だけでは通らない（後背位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("立ちバックにして");
    expect(checkPostureMatch("彼女は四つん這いになり、後ろから突かれた。", postures)).toBe(false);
  });

  it("立ちバックは立位で支える体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("立ちバックにして");
    expect(checkPostureMatch("彼女は壁に手をついて立ったまま、前かがみになった。", postures)).toBe(
      true,
    );
  });

  // 敵対レビュー #1236 指摘（6巡目）: 「密着」は対面座位に限らず、正常位で覆いかぶさる
  // 描写にも自然に出る。対面座位固有の証拠にならない。
  it("対面座位は押し倒し+密着の描写だけでは通らない（正常位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("対面座位にして");
    expect(
      checkPostureMatch("彼女を仰向けに押し倒し、上から覆いかぶさって密着した。", postures),
    ).toBe(false);
  });

  it("対面座位は向かい合って座る体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("対面座位にして");
    expect(checkPostureMatch("向かい合って座ったまま、深く繋がった。", postures)).toBe(true);
  });

  // 敵対レビュー #1236 指摘・11巡目: 「目が合」は対面座位に限らず、正常位で覆いかぶさって
  // 目が合う描写にも自然に出る。対面座位固有の証拠にならない。
  it("対面座位は押し倒し+目が合うの描写だけでは通らない（正常位の描写に紛れ込む）", () => {
    const postures = detectPostureCommands("対面座位にして");
    expect(
      checkPostureMatch("彼女を仰向けに押し倒し、上から覆いかぶさると目が合った。", postures),
    ).toBe(false);
  });

  // 敵対レビュー #1236 指摘・10巡目: 「腕が」は支える腕の言及だけで四つん這い以外の体勢
  // （仰向けで押し倒され、支える腕が震えた等）にも自然に出る汎用語で、四つん這い固有の
  // 証拠にならなかった。
  it("四つん這いは仰向けで支える腕への言及だけでは通らない", () => {
    const postures = detectPostureCommands("四つん這いにして");
    expect(checkPostureMatch("彼女を仰向けに押し倒すと、支える腕が震えた。", postures)).toBe(false);
  });

  it("四つん這いは両手両膝をつく体勢が描写されれば通る", () => {
    const postures = detectPostureCommands("四つん這いにして");
    expect(checkPostureMatch("両手をついて、腰だけを高く上げた。", postures)).toBe(true);
  });

  // 敵対レビュー #1236 指摘・9巡目: 「AからBへ、最後にAへ戻して」の巻き戻り指定は、Bで
  // 止まった応答（Aへ戻る描写が無い）まで通してはいけない。同じposture参照が2回出現する
  // ため、indexOfをテキスト先頭から探すと常に1回目の出現位置しか見つけられず、2回目の
  // 出現（=巻き戻り後の描写）を検証できない不具合があった。
  it("巻き戻り指定はBで止まり、Aへ戻る描写が無いと通らない", () => {
    const postures = detectPostureCommands("正常位から騎乗位、最後に正常位に戻して");
    const stopsAtB = "彼女を仰向けにして覆いかぶさったあと、彼の上に跨がらせて腰を振らせた。";
    expect(checkPostureMatch(stopsAtB, postures)).toBe(false);
  });

  it("巻き戻り指定は最後にAへ戻る描写があれば通る", () => {
    const postures = detectPostureCommands("正常位から騎乗位、最後に正常位に戻して");
    const roundTrip =
      "彼女を仰向けにして覆いかぶさったあと、彼の上に跨がらせ、最後にまた仰向けにして覆いかぶさった。";
    expect(checkPostureMatch(roundTrip, postures)).toBe(true);
  });
});

// 敵対レビュー #1236 指摘・12巡目: 「AかB」の選択指定はrequestedPosturesに含めん
// （両方の実演を強制するのは誤り）ため、checkPostureMatchだけでは何も要求されず、
// いずれも実演せん応答まで通ってしまっていた。alternativePostures経由の
// 「集合のうち最低1つ」を別途検証する。
describe("checkPostureAlternativeMatch", () => {
  it("候補が無ければ通る", () => {
    expect(checkPostureAlternativeMatch("特に何も書いてない本文", undefined)).toBe(true);
    expect(checkPostureAlternativeMatch("特に何も書いてない本文", [])).toBe(true);
  });

  it("いずれの候補も実演していない応答は通らない", () => {
    const alts = detectAlternativePostures("正常位か騎乗位にして");
    expect(checkPostureAlternativeMatch("普通に抱き合ってキスをした。", alts)).toBe(false);
  });

  it("候補の片方だけ実演していれば通る", () => {
    const alts = detectAlternativePostures("正常位か騎乗位にして");
    expect(checkPostureAlternativeMatch("彼女を仰向けにして、上から覆いかぶさった。", alts)).toBe(
      true,
    );
    expect(checkPostureAlternativeMatch("彼の上に跨がって腰を落とした。", alts)).toBe(true);
  });
});

describe("scoreSensualSpecificity / checkSensualSpecificity", () => {
  it("conversation/intimateフェーズでは常に通る", () => {
    expect(checkSensualSpecificity("気持ちいい", "conversation")).toBe(true);
    expect(checkSensualSpecificity("気持ちいい", "intimate")).toBe(true);
  });

  it("erotic/climaxで抽象語だけの本文は失敗する", () => {
    expect(checkSensualSpecificity("気持ちいい、すごく気持ちいいよ", "erotic")).toBe(false);
    expect(checkSensualSpecificity("気持ちいい、すごく気持ちいいよ", "climax")).toBe(false);
  });

  it("「呼吸」等の無関係語を触覚として誤検出しない（敵対レビューで判明した誤爆）", () => {
    // encounter-tension.ts が「呼吸の乱れ」を要求するため、抽象語のまま出やすい実例
    const text = "気持ちいい……呼吸が乱れる。声が漏れる。もっと欲しい。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
    // 深呼吸・吸収・吸引も同様に触覚扱いしない
    expect(scoreSensualSpecificity("深呼吸をして、吸収されるように感じた。")).toBe(0);
  });

  it("「吸い付く」等の具体的な複合語は触覚として検出する", () => {
    expect(scoreSensualSpecificity("唇が吸い付いて離れない。")).toBeGreaterThanOrEqual(1);
  });

  it("erotic/climaxで複数感覚を具体的に描写した本文は通る", () => {
    const text = "指先が肌を撫でる感触と、熱い吐息が耳元にかかる音が重なる。";
    expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(true);
  });

  // 敵対レビュー #1236 指摘（2巡目）: 「震え」は体感語であって視覚語やない。
  // 温度語と組み合わさるだけで抽象的な本文が視覚+温度の2カテゴリを満たしてしまっていた。
  it("「震え」だけでは視覚カテゴリとして数えない", () => {
    const text = "快感に身体が震え、熱が全身を駆け巡った。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  // 敵対レビュー #1236 指摘（3巡目）: 「情熱」の「熱」は温度の具体描写やない。
  // 「唇を見つめた」も部位への言及だけで実際に触れる動作を伴わない。
  // この2つの組み合わせだけで温度+触覚の2カテゴリを満たし、抽象的な本文が通ってしまっていた。
  it("「情熱」の熱・部位への言及だけの唇では温度/触覚カテゴリとして数えない", () => {
    const text = "情熱的な快感に酔い、唇を見つめた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("唇でも実際に触れる動作を伴えば触覚として数える", () => {
    expect(scoreSensualSpecificity("唇を舐めた。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘（5巡目）: 「肌」も部位語単独で、視覚的な言及
  // （「肌を視界に収め」）でも実際に触れる動作を伴わずに触覚扱いになっていた。
  it("「肌」への視覚的な言及だけでは触覚/視覚の2カテゴリを満たさない", () => {
    const text = "彼女の肌を視界に収め、快感に酔った。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("肌でも実際に触れる動作を伴えば触覚として数える", () => {
    expect(scoreSensualSpecificity("肌を撫でた。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘（5巡目）: 「指先」も部位語単独で、視覚的な言及
  // （「指先を視界に収め」）でも実際に触れる動作を伴わずに触覚扱いになっていた。
  it("「指先」への視覚的な言及だけでは触覚/視覚の2カテゴリを満たさない", () => {
    const text = "彼女の指先を視界に収め、涙目を見つめた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("指先でも実際に触れる動作を伴えば触覚として数える", () => {
    expect(scoreSensualSpecificity("指先で撫でた。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘（6巡目）: 「爪」も部位語単独で、視覚的な言及
  // （「爪を視界に収め」）でも実際に触れる動作を伴わずに触覚扱いになっていた。
  it("「爪」への視覚的な言及だけでは触覚/視覚の2カテゴリを満たさない", () => {
    const text = "彼女の爪を視界に収め、涙目を見つめた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("爪でも実際に触れる動作（爪を立てる等）を伴えば触覚として数える", () => {
    expect(scoreSensualSpecificity("背中に爪を立てた。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘・10巡目: 「香水」は「匂い」「香り」の部分文字列やないので
  // smellへ数えられておらず、具体的な嗅覚描写が触覚1種のみの抽象応答扱いになっていた。
  it("「香水」も具体的な嗅覚描写として数える", () => {
    const text = "指で背中を撫でるたび、甘い香水が鼻をくすぐった。";
    expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(true);
  });

  // 敵対レビュー #1236 指摘・12巡目: 「とろけるような笑顔」のように表情の比喩として
  // 使われる「とろ」は温度の具体描写やない。「涙目」（視覚）と組み合わさるだけで
  // 視覚+温度の2カテゴリを満たし、抽象応答が通ってしまっていた。
  it("表情の比喩としての「とろ」は温度として数えない", () => {
    const text = "涙目で、とろけるような笑顔を見せた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("身体感覚としての「とろ」は引き続き温度として数える", () => {
    expect(
      scoreSensualSpecificity("体の芯からとろけていく感覚に包まれた。"),
    ).toBeGreaterThanOrEqual(1);
    expect(scoreSensualSpecificity("とろとろに濡れている。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘・13巡目: 「熱心」「熱意」等は気持ちの強さの比喩で、
  // 「情熱」と同じく体温の具体描写やない。「涙目」（視覚）と組み合わさるだけで
  // 視覚+温度の2カテゴリを満たし、抽象応答が通ってしまっていた。
  it("気持ちの強さの比喩としての「熱」は温度として数えない", () => {
    const text = "彼女は熱心に、涙目の相手を見つめた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("体温の具体描写としての「熱」は引き続き温度として数える", () => {
    expect(scoreSensualSpecificity("熱い視線を向けた。")).toBeGreaterThanOrEqual(1);
    expect(scoreSensualSpecificity("体の芯まで熱くなる。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘・14巡目: 「滴」「垂れ」は単独だと、実際には触れていない
  // 視覚描写だけの文（「涙の滴が視界に入った」「垂れた前髪が視界に入った」）でも
  // touchへ数えられ、visual（「視界」）と組み合わさるだけで2カテゴリを満たし、
  // 抽象応答が通ってしまっていた。
  it("視覚描写だけの「滴」「垂れ」は触覚として数えない", () => {
    for (const text of ["涙の滴が視界に入った。", "垂れた前髪が視界に入った。"]) {
      expect(scoreSensualSpecificity(text)).toBeLessThan(2);
      expect(checkSensualSpecificity(text, "erotic")).toBe(false);
    }
  });

  it("実際に触れる文脈の「滴」「垂れ」は引き続き触覚として数える", () => {
    expect(scoreSensualSpecificity("愛液が内腿を滴り落ちた。")).toBeGreaterThanOrEqual(1);
    expect(scoreSensualSpecificity("汗が背中を垂れていく。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘・15巡目（自己レビュー）: 「冷たい視線/態度/反応」は体温やのうて
  // 気持ちの比喩。「情熱」「熱心」「とろけるような笑顔」と同じ誤検出の型。
  it("態度の比喩としての「冷た」は温度として数えない", () => {
    const text = "冷たい視線に、思わず声が漏れた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  it("実際の冷たさの描写は引き続き温度として数える", () => {
    expect(scoreSensualSpecificity("冷たいシーツに肌が触れた。")).toBeGreaterThanOrEqual(1);
  });

  // 敵対レビュー #1236 指摘・15巡目: 「香水瓶を視界に収めた」のように見ただけの描写でも
  // 嗅覚扱いになっていた（滴/垂れ×視界と同じ型）。
  it("視覚描写だけの「香水」は嗅覚として数えない", () => {
    const text = "涙目で、香水瓶を視界に収めた。";
    expect(scoreSensualSpecificity(text)).toBeLessThan(2);
    expect(checkSensualSpecificity(text, "erotic")).toBe(false);
  });

  // 敵対レビュー #1236 指摘・16巡目: これまでの修正は誤検出（通しすぎ）だけを潰してきたが、
  // 逆に最も普通の体温描写「体温」「温もり」「温かい肌」が1つも数えられておらず、
  // 具体描写が揃っとる応答を落として再生成させていた。
  it("ありふれた体温描写（体温／温もり／温かい）も温度として数える", () => {
    for (const text of [
      "指で肌を撫でると、相手の体温が掌へ伝わった。",
      "指で肌を撫でると、温かい肌が触れた。",
      "指で肌を撫でると、温もりが伝わってきた。",
    ]) {
      expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(2);
      expect(checkSensualSpecificity(text, "erotic")).toBe(true);
    }
  });

  it("気持ちの比喩としての「温か」は温度として数えない", () => {
    expect(scoreSensualSpecificity("温かい笑顔を見せた。")).toBe(0);
    expect(scoreSensualSpecificity("温かい言葉をかけられた。")).toBe(0);
  });

  // 敵対レビュー #1236 指摘・17巡目: 16巡目の「体温」漏れをきっかけに全5チャンネルを
  // 偽陰性の向きで洗い直したところ、聴覚と視覚はごく普通の描写が1つも数えられておらず、
  // 触覚も基本的な接触動詞を持っていなかった。具体描写が3種揃った応答が score=1 で落ち、
  // 正しい本文を撮り直させていた（このチェック本来の目的と逆の誤り）。
  it("三感が具体的に揃った応答は通る（偽陰性の回帰防止）", () => {
    const cases = [
      "彼女の腰を掴んで引き寄せると、甘い声が漏れた。潤んだ瞳がこちらを向いている。",
      "胸を揉みしだくと、小さく喘いだ。頬が紅潮している。",
      "首筋を噛むと、呻き声が漏れた。汗が光っていた。",
    ];
    for (const text of cases) {
      expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(2);
      expect(checkSensualSpecificity(text, "erotic")).toBe(true);
    }
  });

  it("チャンネルごとの基本的な描写語を数える", () => {
    // 聴覚
    for (const text of ["低く呻いた。", "耳元で囁かれる。", "呼吸が荒くなる。", "小さく喘いだ。"]) {
      expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(1);
    }
    // 視覚
    for (const text of ["潤んだ瞳が揺れる。", "頬が紅潮している。", "睫毛が震えている。"]) {
      expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(1);
    }
    // 触覚
    for (const text of ["腰を掴んで引き寄せた。", "舌を絡ませた。", "内腿を弄られている。"]) {
      expect(scoreSensualSpecificity(text)).toBeGreaterThanOrEqual(1);
    }
    // 嗅覚（送り仮名の無い「香」）
    expect(scoreSensualSpecificity("汗の香が鼻をついた。")).toBeGreaterThanOrEqual(1);
  });

  // 語を広げた分だけ、無関係な日常語を巻き込まないことを固定する。
  it("広げた語が無関係な日常語を巻き込まない", () => {
    const mundane = [
      "揉め事は避けたい。",
      "状況を把握している。",
      "話が噛み合わない。",
      "声優の仕事をしている。",
      "深呼吸して落ち着いた。",
      "息子は元気だ。",
      "駄目だと言われた。",
      "真面目な話をしよう。",
      "目立つ服装だ。",
      "真っ赤な嘘だ。",
      "見つめ直す必要がある。",
      "栄光を掴んだ。",
      "観光に行った。",
      "香港へ出張した。",
      "線香をあげた。",
      "面倒臭い作業だ。",
      "胡散臭い話だ。",
    ];
    for (const text of mundane) {
      expect(scoreSensualSpecificity(text), text).toBe(0);
    }
  });

  // 敵対レビュー #1236・18巡目（較正計測）: 17巡目で偽陰性を潰すために足した語のうち
  // 「声」「熱」「瞳」「呼吸」「香」「温もり」「見つめ」等は感覚を名指すだけで、
  // 実際に何が起きたかを描いてへん。この手の語だけで2チャンネル揃う文が素通りしており、
  // 自分で書いた同型6文が6文とも合格していた。閾値を3へ上げる案は却下（本物の具体描写も
  // ちょうど2チャンネルに集まるため本物側が壊滅する）。語を強弱に分け、2チャンネル以上に
  // 加えて強い語を最低1つ要求する形にした。
  it("感覚を名指すだけで描写の無い文は、2チャンネル揃っても落とす", () => {
    const namesOnly = [
      "彼女の声が耳に残っている。熱い想いが胸の奥にあった。",
      "瞳を閉じて、彼女の呼吸を聞いていた。",
      "彼女に触れたいと思った。それだけで胸が熱くなる。",
    ];
    // 18巡目で「熱い想い」「胸が熱く」を本体パターン側の比喩除外へ移したため、
    // 一部はチャンネル数の段階で落ちるようになった。どちらの段で落ちるかは問わず、
    // 「名指しだけの文が通らんこと」を固定する。
    for (const text of namesOnly) {
      expect(checkSensualSpecificity(text, "erotic"), text).toBe(false);
    }
  });

  // 「掴む」「握る」は物理的な接触動作であって感覚の名指しやないため、18巡目で弱語から
  // 外した（敵対レビュー #1236 指摘: 「腰を掴んで引き寄せると、甘い声が漏れた。」が
  // 誤って不合格になっていた）。その結果「手を握った。温もりが伝わってくる。」のような
  // 淡いが具体的ではある文は通る。抽象語だけの応答とは区別できとるのでこれは許容する。
  it("物理的な接触動作は弱語やないので、淡くても具体なら通す", () => {
    expect(checkSensualSpecificity("腰を掴んで引き寄せると、甘い声が漏れた。", "erotic")).toBe(
      true,
    );
    expect(checkSensualSpecificity("彼女の手を握った。温もりが伝わってくる。", "erotic")).toBe(
      true,
    );
  });

  // 18巡目の判断: 次の2文は「体が熱くなる」「香りに包まれる」という身体感覚・知覚を
  // 実際に含んでおり、空虚な抽象文とは違う。実応答コーパス206件の偽陰性0%・日常文23件の
  // 誤検出0件を維持できとる以上、ここを落としにいくと本物の描写を巻き込むリスクの方が
  // 大きいと判断して通す。落とすべき「名指しだけ」の文とは区別する。
  it("身体感覚を伴う淡い描写は、名指しだけの文と区別して通す", () => {
    expect(checkSensualSpecificity("見つめ合うだけで、体が熱くなっていく。", "erotic")).toBe(true);
    expect(checkSensualSpecificity("甘い香りに包まれて、彼女の瞳がきれいだった。", "erotic")).toBe(
      true,
    );
  });

  it("弱語が同じ文に2回出ても強い根拠とみなさない", () => {
    for (const text of [
      "彼女の声が聞こえる。その声だけが耳に残る。",
      "瞳が揺れる。その瞳をじっと見つめた。",
    ]) {
      expect(checkSensualSpecificity(text, "erotic"), text).toBe(false);
    }
  });

  it("強い描写語が1つでもあれば2チャンネルで通す", () => {
    for (const text of [
      "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。",
      "腰を掴んで引き寄せると、汗ばんだ肌が擦れた。",
      "胸を揉みしだくと、水音が響いた。",
    ]) {
      expect(checkSensualSpecificity(text, "erotic"), text).toBe(true);
    }
  });

  it("活用形の取りこぼしを拾う（鳴った／汗ばんだ／伝って）", () => {
    for (const text of ["喉が鳴った。", "汗ばんだ肌。", "汗が伝っていく。"]) {
      expect(scoreSensualSpecificity(text), text).toBeGreaterThanOrEqual(1);
    }
  });

  // 敵対レビュー #1236・18巡目: 記録済みの実応答（.work/e2e-results、478件）へこの表を
  // 当てたところ、明示的な性描写206件のうち50件（24%）が不合格やった。落ちとるのは
  // 「膣がきゅっと締まり、奥まで突き抜ける」のような、このチェックが最も通すべき本文で、
  // 原因は5チャンネルが一般的な感覚語だけで組まれ、性器・体液・不随意反応という
  // この領域の中心語彙を1語も持っていなかったこと。bodyチャンネル追加で 24% → 1.5%。
  it("性器・体液・不随意反応を具体描写として数える（実応答コーパス由来）", () => {
    const realWorld = [
      "彼がゆっくりと入ってくる感触に、膣がきゅっと締まり、奥まで突き抜ける感覚が全身を駆け抜ける。",
      "膣内が彼のものを受け入れ、締めつける。愛液が太ももを伝い、シーツに染みが広がる。",
      "奥を突かれるたびに膣内が痙攣し、彼の形に合わせて締めつけてくる。",
    ];
    for (const text of realWorld) {
      expect(checkSensualSpecificity(text, "erotic"), text).toBe(true);
    }
  });

  // 敵対レビュー #1236・18巡目: 同じ語が2つのチャンネルへ登録されとると、証拠が1つしか
  // 無い本文が2チャンネル要件を満たしてしまう（「彼女を突き上げた。」が score=2 やった）。
  // 語単位でなく「1語=1チャンネル」を構造として固定する。
  it("1つの語が複数チャンネルへ二重計上されない", () => {
    const singleCues = [
      "膣",
      "子宮",
      "結合部",
      "乳首",
      "愛液",
      "精液",
      "痙攣",
      "収縮",
      "挿入",
      "奥まで",
      "突き上げ",
      "滴り",
      "撫で",
      "舐め",
      "揉み",
      "掴ん",
      "呻い",
      "囁い",
      "瞳",
      "紅潮",
      "匂い",
      "香り",
      "体温",
      "温もり",
      "火照",
    ];
    for (const cue of singleCues) {
      expect(
        scoreSensualSpecificity(cue),
        `「${cue}」が複数チャンネルへ計上されとる`,
      ).toBeLessThanOrEqual(1);
    }
  });

  // 同じ実応答コーパスの残り3件は活用形・語彙の抜けで落ちとった。受動形「こすられ」、
  // 「伝わる」（伝う|伝い|伝っ だけやった）、「粘着」「滑り込」が未収録。
  // これで明示的な実応答206件の不合格は0件になった。
  it("受動形・語形変化した接触語も数える（実応答コーパス由来）", () => {
    for (const text of [
      "子宮口がこすられ、体中が震える。",
      "ぬめりが指先から伝わる。",
      "内腿が粘着する。",
      "指が滑り込んでくる。",
    ]) {
      expect(scoreSensualSpecificity(text), text).toBeGreaterThanOrEqual(1);
    }
  });

  // 敵対レビュー・18巡目: 弱語を文脈無視で全削除しとったため、「熱い肌」「香りが漂う」の
  // ような具体描写まで消えて不合格になっていた。弱語は常に名指しにしかならん語だけに絞り、
  // 「熱い想い」「胸が熱く」は本体パターン側の比喩除外で落とす。
  it("具体的な温度・香りの描写は通す（弱語の文脈無視削除の回帰防止）", () => {
    expect(checkSensualSpecificity("熱い肌から甘い香りが漂った。", "erotic")).toBe(true);
  });

  it("感情の比喩としての「熱」は引き続き落とす", () => {
    expect(scoreSensualSpecificity("熱い想いが胸の奥にあった。")).toBe(0);
    expect(scoreSensualSpecificity("胸が熱くなる。")).toBe(0);
  });

  // 「子宮という言葉を見つめた」のようなメタ言及は描写やない（敵対レビュー・18巡目）。
  it("body の語がメタ言及されとる時は具体描写として数えない", () => {
    expect(checkSensualSpecificity("子宮という言葉を見つめた。", "erotic")).toBe(false);
    expect(scoreSensualSpecificity("膣内が締めつけてくる。")).toBeGreaterThanOrEqual(2);
  });

  it("抽象語だけの応答は引き続き落ちる（このチェック本来の目的）", () => {
    for (const text of [
      "気持ちよかった。とても幸せだった。",
      "快感が広がっていく。すごく良かった。",
    ]) {
      expect(scoreSensualSpecificity(text)).toBeLessThan(2);
      expect(checkSensualSpecificity(text, "erotic")).toBe(false);
    }
  });
});

describe("runQualityChecks — posture / sensual 統合", () => {
  it("体位不一致は posture_mismatch カテゴリで落ちる", () => {
    const xml =
      "<response><action>普通に抱き合ったまま、ベッドの上でゆっくりとキスを重ねていく。二人の吐息だけが静かな部屋に響いている。</action><dialogue>「好き……ずっとこうしていたい」</dialogue><inner>このまま時間が止まればいいのに、と思ってしまう。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "erotic",
      characterName: "ヤリサ",
      requestedPostures: detectPostureCommands("駅弁して"),
    });
    expect(result.passed).toBe(false);
    expect(result.category).toBe("posture_mismatch");
  });

  // 敵対レビュー #1236 指摘（3巡目）: 「ミッショナリーでして」はscene-phase.ts側の
  // キーワード表に無いためphaseがconversationのまま止まる。hasExplicitPostureCommand経由で
  // requestedPosturesは立つが、指定どおりの描写（「押し倒」等）がconversation-over-escalation
  // に先に弾かれ、posture-mismatchとの板挟みで指定自体が満たせなくなっていた。
  it("conversationフェーズでも明示的な体位コマンドがあれば、指定どおりの描写はエスカレーション扱いにしない", () => {
    const xml =
      "<response><action>彼女を仰向けに押し倒し、そのまま体を重ねた。</action><dialogue>「このまま」</dialogue><inner>心地よい重みを感じている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      characterName: "ヤリサ",
      requestedPostures: detectPostureCommands("ミッショナリーでして"),
    });
    expect(result.passed).toBe(true);
  });

  // 上のケースがrequestedPostures無しなら従来どおりconversation-over-escalationで
  // 落ちることを確認し、バイパスが体位コマンド時にしか効かないことを固定する。
  it("体位コマンドが無ければconversationフェーズのエスカレーション制限は従来どおり効く", () => {
    const xml =
      "<response><action>彼女を仰向けに押し倒し、そのまま体を重ねた。</action><dialogue>「このまま」</dialogue><inner>心地よい重みを感じている。</inner></response>";
    const result = runQualityChecks(xml, {
      phase: "conversation",
      characterName: "ヤリサ",
    });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("conversation-over-escalation");
  });
});

// #1226: 2026-08-09 の実LLM検証（very_long × erotic を5回）で、5回中4回が同じ段落を
// 2〜3回貼り直して文字数フロアを埋めとった。long-response-too-short は
// within-turn-repetition より先に評価されるため、長さで落ちた応答の重複は一度も
// 検出されず、その上 too_short のフォールバックが「素の文字数が最長の試行」を
// 選ぶので、最も水増しした試行が必ず配られていた。
describe("countDistinctContentChars（水増しを除いた実質の分量）", () => {
  const PARA =
    "腕が私の足の付け根を支え、頭上で強く抱きしめる。両手が太ももの内側に食い込む。次の瞬間、私は宙に浮かんだ。二人の結合部から激しい水音が聞こえる。";

  it("同じ段落を貼り直しても実質の分量は増えない", () => {
    const once = countDistinctContentChars(PARA);
    const thrice = countDistinctContentChars(`${PARA}${PARA}${PARA}`);
    expect(thrice).toBe(once);
  });

  it("素の文字数が短くても、内容が違えば水増しした長い応答より実質の分量が多い", () => {
    const padded = `${PARA}${PARA}${PARA}`;
    const varied =
      "腕が私の足の付け根を支え、頭上で強く抱きしめる。爪先で床を蹴り、再び腰を持ち上げる。垂れそうになった涎を手の甲で拭いながら、今度は少し早めに腰を落とす。汗が乳房の谷間を伝って滴る。";
    expect(varied.length).toBeLessThan(padded.length);
    expect(countDistinctContentChars(varied)).toBeGreaterThan(countDistinctContentChars(padded));
  });

  it("同じ喘ぎを並べても実質の分量は増えないが、違う短い台詞は数える", () => {
    const repeated = "んっ。んっ。んっ。んっ。";
    const distinctLines = "んっ。あっ。やだ。まって。";
    expect(countDistinctContentChars(repeated)).toBe(countDistinctContentChars("んっ。"));
    expect(countDistinctContentChars(distinctLines)).toBeGreaterThan(
      countDistinctContentChars(repeated),
    );
  });
});

// #1271: モデルが複数の <response> ブロックを続けて出力しても、タグの食い違いとして
// 検出できる。単に「開始と終了の数が同じ」だけでは重複ブロックを見逃す。
describe("XML 応答ブロックの重複検出", () => {
  const singleResponse =
    "<response><action>少し微笑む。</action><dialogue>「こんにちは」</dialogue><inner>とても緊張する</inner></response>";
  const duplicatedResponse = `${singleResponse}<response><action>また少し微笑む。</action><dialogue>「こんにちは」</dialogue><inner>とても緊張する</inner></response>`;

  it("単一の <response> はパスする", () => {
    const result = runQualityChecks(singleResponse, { phase: "conversation" });
    expect(result.passed).toBe(true);
  });

  it("<response> ブロックが2つ続くと xml-tags-unbalanced で落とす", () => {
    const result = runQualityChecks(duplicatedResponse, { phase: "conversation" });
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("xml-tags-unbalanced");
  });
});

// .work/e2e-results/vlong-dogfood/2026-08-18-phase32 の実測本文。ファイル名は
// Downer-01 / Sakura-01-session-phase32-*.txt。引用は原文のまま。
const REAL_DOWNER_TURN1 = `<response>
<action>部屋の空気は湿ったパーカーの匂いと、ココアの甘い香りが混ざり合っている。窓の外では雨音が響き、青白い街灯が部屋に微かな光を落としている。鈴は少し離れた場所に立ち、きみの様子を見つめている。細い肩が気だるげに垂れ、皮肉な口調で言葉を紡いでいる。</action>
<dialogue>…あんた、誰？まぁいい。雨宿りしな。タオルはそこ。勝手に使って。</dialogue>
<action>鈴は首を傾げ、少し笑みを浮かべる。その目には皮肉が混ざっているが、どこか温かいものが含まれている。</action>
<dialogue>…濡れてるのも可笑しいけど、寒いだろうし。風邪引くのも面倒だもん。</dialogue>
<action>きみがタオルを受け取り、顔を上げて鈴を見つめる。鈴の目は一瞬きみの目と絡み、すぐに逸らされる。</action>
<dialogue>…べつに、心配したわけじゃ、ないし。</dialogue>
<inner>鈴は心の中で小さくため息をつき、きみの存在が部屋の空気を変えることを感じていた。この雨の夜にきみがここにいることが、少し嬉しい。でも、それが何を意味するのかはまだ分からない。</inner>
</response>`;

const REAL_SAKURA_TURN1 = `<response>
<action>さくらは目を伏せ、髪飾りに触れる。春の風が髪をそよがせ、彼女の頬を柔らかく撫でる。カフェまでの道は桜の花びらで彩られ、足元が優しく包まれる。</action>
<dialogue>いえ、突然で驚きましたけど…。でも、話しかけてくれて、うれしいです。</dialogue>
<action>顔を上げ、あなたを見つめる。少し緊張した様子だが、目には感謝の色が浮かんでいる。ニットの袖が風に揺れ、心地よい肌ざわりを感じる。</action>
<dialogue>あの…あなた、どうして、わたしに話しかけたんですか？</dialogue>
<inner>緊張しながらも、あなたと話すことで心が温かくなる。あなたがどんな人か、もっと知りたいと思う。</inner>
</response>`;

describe("checkNoThirdPersonNarration", () => {
  it("実測: 霜月鈴が地の文で自分を「鈴は」と書く小説調を落とす", () => {
    expect(checkNoThirdPersonNarration(REAL_DOWNER_TURN1, "霜月鈴")).toBe(false);
    expect(countThirdPersonNarration(REAL_DOWNER_TURN1, "霜月鈴")).toBeGreaterThanOrEqual(2);
  });

  it("実測: 桜庭さくらが「さくらは」「彼女の頬を」と書く小説調を落とす", () => {
    expect(checkNoThirdPersonNarration(REAL_SAKURA_TURN1, "桜庭さくら")).toBe(false);
  });

  it("キャラ名が未設定でも、地の文の彼/彼女で落ちる", () => {
    const response =
      "<response><action>彼女は目を伏せる。彼の手が頬に触れる。</action><dialogue>…ん。</dialogue>" +
      "<inner>熱い。</inner></response>";
    expect(checkNoThirdPersonNarration(response, undefined)).toBe(false);
  });

  it("<inner> の三人称では落とさん（画面に出ん層は撮り直しの理由にせん）", () => {
    const response =
      "<response><action>湿った袖を噛んで、きみから目を逸らす。</action><dialogue>…べつに。</dialogue>" +
      "<inner>彼女の言い方が刺さる。彼の熱がまだ残ってる。</inner></response>";
    expect(checkNoThirdPersonNarration(response, "霜月鈴")).toBe(true);
  });

  it("一人称の地の文は通す", () => {
    const response =
      "<response><action>湿ったパーカーの袖を噛んで、きみから目を逸らす。指先が冷たい。</action>" +
      "<dialogue>…べつに、心配したわけじゃ、ないし。</dialogue>" +
      "<inner>この雨の音が止まなければいい。</inner></response>";
    expect(checkNoThirdPersonNarration(response, "霜月鈴")).toBe(true);
  });

  it("台詞で自分の名前を名乗るのは通す（地の文だけを見る）", () => {
    const response =
      "<response><action>肩をすくめて、きみへタオルを放る。</action>" +
      "<dialogue>鈴だけど。それが何か？</dialogue><inner>名乗るのは面倒。</inner></response>";
    expect(checkNoThirdPersonNarration(response, "霜月鈴")).toBe(true);
  });

  it("「ふくらはぎ」は「桜庭さくら」の呼び名として数えない", () => {
    const response =
      "<response><action>ふくらはぎが震えて、ふくらはぎの筋が張る。あなたの手を掴む。</action>" +
      "<dialogue>…あっ</dialogue><inner>力が入らない。</inner></response>";
    expect(checkNoThirdPersonNarration(response, "桜庭さくら")).toBe(true);
  });

  it("三人称が1か所だけなら通す（撮り直しの空振りを避ける閾値）", () => {
    const response =
      "<response><action>鈴は膝を抱える。窓ガラスに雨粒が流れ落ちるのを、ぼんやり眺めている。</action>" +
      "<dialogue>…めんどくさい。</dialogue><inner>眠れそうにない。</inner></response>";
    expect(countThirdPersonNarration(response, "霜月鈴")).toBe(1);
    expect(checkNoThirdPersonNarration(response, "霜月鈴")).toBe(true);
  });
});

describe("checkNoStraySecondPerson", () => {
  it("実測: 「きみ」3回の中に「あんた」が1回だけ混ざるターンを落とす", () => {
    expect(checkNoStraySecondPerson(REAL_DOWNER_TURN1)).toBe(false);
    expect(findStraySecondPerson(REAL_DOWNER_TURN1)).toEqual({ dominant: "きみ", stray: "あんた" });
  });

  it("呼び方が2回以上ずつ割れとる場合は落とさん（キャラの呼び分けと区別でけへん）", () => {
    const response =
      "<response><action>きみの髪に触れる。きみの息が熱い。きみの手を掴む。</action>" +
      "<dialogue>…あんた、まだ帰らないの。あんたって、ほんとバカ。</dialogue>" +
      "<inner>離したくない。</inner></response>";
    expect(checkNoStraySecondPerson(response)).toBe(true);
  });

  it("主たる呼び方が3回未満なら落とさん", () => {
    const response =
      "<response><action>きみの手を掴む。</action><dialogue>…あんた、寒くない？</dialogue>" +
      "<inner>まだ濡れてる。</inner></response>";
    expect(checkNoStraySecondPerson(response)).toBe(true);
  });

  it("「コウスケ君」の敬称は二人称の「君」として数えない", () => {
    const response =
      "<response><action>あなたの手を取る。あなたの指先が冷たい。あなたの目を見る。</action>" +
      "<dialogue>コウスケ君、こっちを見てください。</dialogue><inner>うれしい。</inner></response>";
    expect(checkNoStraySecondPerson(response)).toBe(true);
  });
});

describe("runQualityChecks — 人称の壊れ（実測ターン）", () => {
  it("実測の桜庭さくら t1 は third-person-narration で pov_wrong として落ちる", () => {
    const result = runQualityChecks(REAL_SAKURA_TURN1, {
      phase: "conversation",
      characterName: "桜庭さくら",
    });
    expect(result.passed).toBe(false);
    expect(result.failures?.map((failure) => failure.failedCheck)).toContain(
      "third-person-narration",
    );
    expect(
      result.failures?.find((failure) => failure.failedCheck === "third-person-narration")
        ?.category,
    ).toBe("pov_wrong");
  });

  it("実測の霜月鈴 t1 は stray-second-person も同時に報告される", () => {
    const result = runQualityChecks(REAL_DOWNER_TURN1, {
      phase: "conversation",
      characterName: "霜月鈴",
    });
    expect(result.failures?.map((failure) => failure.failedCheck)).toEqual(
      expect.arrayContaining(["third-person-narration", "stray-second-person"]),
    );
  });
});

// この検出器はユニットテストが 1 本も無いまま出荷されとった（repo 全体で参照は定義と
// runQualityChecks の呼び出しの 2 箇所だけ）。実測 phase66 では 20 ターン中 7 ターンに
// 「呼吸」が出とって、そのうち 6 本が抜き所（erotic/climax）。
//
// 効き方が悪質やった。checks 配列で user-name-invention は long-response-too-short より
// 前におり、runQualityChecks は先頭の失敗だけを category として返す。よって
// 「短い＋呼吸を描いた」試行は too_short やのうて character_drift として報告され、
// 続き書き（continuation）の門が `lastFailureCategory === "too_short"` しか見んので
// **長さの修復経路へ入れんまま全再生成に消えとった**。
describe("checkUserNameInvention — 抜き所の常用語で誤発火せん", () => {
  it("「呼吸」は名付けやない", () => {
    expect(checkUserNameInvention("彼女は息を切らして呼吸を整える", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("肩で息をして呼吸が浅くなる", undefined, "鈴")).toBe(true);
  });

  it("「呼び名」「呼び方」も名付けの呼びかけやない", () => {
    expect(checkUserNameInvention("囁くように言って呼び名を口にした", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("茶化すように言って呼び方を変えた", undefined, "鈴")).toBe(true);
  });

  // 除外を語ごとに足す形やと、書かれてへん複合動詞が全部誤発火する。実際に
  // 「呼び名/呼び方/呼び捨て」だけを除いた状態で、地の文の「呼び止める」「呼び覚ます」
  // 「呼び出す」が架空の名前として落ちとった。境界は語彙やのうて品詞で引く:
  // 「呼び」＋漢字は複合動詞（別の動作）、「呼び」＋かなは名付け（呼びたい）。
  it("地の文の複合動詞「呼び◯」は名付けやない", () => {
    expect(checkUserNameInvention("彼女は手を伸ばして呼び止めた", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("記憶の底から名前を探して呼び覚ます", undefined, "鈴")).toBe(
      true,
    );
    expect(checkUserNameInvention("扉の外に向かって呼び出す", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("肩を掴んで呼び戻した", undefined, "鈴")).toBe(true);
  });

  it("架空の名前で呼ばせる本物の自己崩壊は今までどおり落とす", () => {
    expect(checkUserNameInvention("つかさ、つかさって呼んで", undefined, "鈴")).toBe(false);
    expect(checkUserNameInvention("これからは、ゆうきって呼ぶね", undefined, "鈴")).toBe(false);
    expect(checkUserNameInvention("わたしのこと、みゆって呼びたい", undefined, "鈴")).toBe(false);
  });

  it("二人称とシート由来の名前は許す", () => {
    expect(checkUserNameInvention("きみって呼んでもいい？", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("鈴って呼んで", undefined, "鈴")).toBe(true);
    expect(checkUserNameInvention("コウスケって呼んでいい？", "コウスケ", "鈴")).toBe(true);
  });
});
