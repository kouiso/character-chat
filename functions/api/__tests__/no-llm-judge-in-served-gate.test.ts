import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkServerSideQuality } from "../lib/route-context";

// issue #1495 §8「LLM 採点をゲートにせん」／L1-6「LLM 自己採点が消えとる」。
// /api/nukeru は消えたが、配信経路の checkServerSideQuality は claudeJudgeQuality を
// 呼び続けとった。shouldRunClaudeJudge は erotic/climax **または sceneName 有り**で真になるので、
// シナリオを持つキャラでは実質どの段でも 1 ターンにつき LLM 往復が 1 本増えとった。
//
// 効いとる所は 2 つ。
//  1. 70 秒の壁（TURN_GENERATION_WALL_CLOCK_CAP_MS）と 3 回の試行上限を、続き書きと取り合う
//  2. 決定論チェックを全部通った本文を、LLM の意見だけで不合格にして撮り直しへ回す
// very_long だけは 1828 行の早期 return で守られとった（罠 §5-5「very_long だけ守られて
// medium が無防備」の形そのもの）。出荷既定は medium なので、局長には守りが届いてへんかった。
//
// この機構テストは「配信経路から LLM 採点が消えとる」ことだけを固定する。
// /api/judge（オフライン評価）と shadow 計測は対象外で、そのまま残ってええ。

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 決定論チェックを全部通る本文（実測の抜き所本文と同じ形を最小化したもの）。
// ここが落ちるとテストが空振りするので、下で deterministicPass も併せて確かめる。
const PASSING_EROTIC_BODY = `<response>
<action>汗ばんだ内腿へ手のひらを滑らせると、しっとりした肌が指の腹に吸いつく。</action>
<dialogue>…そこ、だめ。声、出ちゃう。</dialogue>
<action>奥へ指を沈めると、粘つく音が耳の裏で跳ね、腰が跳ねて背中が反る。</action>
<dialogue>ん、っ…もっと、奥まで来て。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;

const PASSING_CONVERSATION_BODY = `<response>
<action>窓の外の雨音が、ぬるくなったココアの湯気をゆっくり揺らしている。</action>
<dialogue>…で、きみはなんでこんな時間に、外にいたの。</dialogue>
<inner>訊いておいて、答えを待つのが少し怖い。</inner>
</response>`;

describe("配信経路の品質ゲートに LLM 採点を置かん", () => {
  it("erotic の medium で judge を呼ばん（外向き通信がゼロ）", async () => {
    const result = await checkServerSideQuality(PASSING_EROTIC_BODY, {
      phase: "erotic",
      isVeryLongResponse: false,
    });

    // 空振り防止: 決定論チェックで落ちとったら judge はもともと呼ばれん。
    expect(result.deterministicPass).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ran).toBe(false);
    expect(result.pass).toBe(true);
  });

  it("sceneName がある conversation でも judge を呼ばん", async () => {
    const result = await checkServerSideQuality(PASSING_CONVERSATION_BODY, {
      phase: "conversation",
      sceneName: "雨の夜の部屋",
      isVeryLongResponse: false,
    });

    expect(result.deterministicPass).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ran).toBe(false);
  });

  it("フロアを課しとるターンでも judge を呼ばん（続き書きと壁を取り合わせん）", async () => {
    const result = await checkServerSideQuality(
      PASSING_EROTIC_BODY,
      // フロアの数字自体は論点やない。「フロアを課しとる」状態を作れればええので、
      // この本文が通る値にする（900 のままやと長さで落ちて judge へ届かず空振りする）。
      { phase: "climax", longResponseMinChars: 50, isVeryLongResponse: false },
    );

    expect(result.deterministicPass).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ran).toBe(false);
  });
});
