# old / new 戦略 v5（敵対レビュー 4 周目を畳んだ確定版）

作成: 2026-09-05 19:00 JST。old = 旧アプリ（PR #1500、磯貝さんが触る台）、new = 作り直し（PR #1501）。v4 §4 の表（既発射分の読み直し）と §6（凍結・配線）は有効。以下は v4 を上書きする。


1. 事実（新）: climax の口調 1 文（ci65 ×2、6ea9e328）は t7 を動かした（2/2 ○、ci50 は 0/2）が t8・t9 は基準線と同じ 0。band 非依存の grep でも ci65 t9 の <dialogue> に です/ます/ください が 1 個も無い。A は終い、これ以上触らん。
2. 事前登録した「t9 で 0 本なら台を替える」は無効な引き金やった。t9 丁寧語 0 は old×adult 10 run 10/10（0/88 文）の定数で情報を持たん。台（old）は替えん（音声・画像の理由は生きとる）。doc:652 で磯貝さんへ投げた (A)/(B) の二択は取り下げる。
3. 判定の順位: 移送も live への搭載も (ii) rubric と (b) 前進だけで決める。(i) 丁寧語は三つ組を貼るだけで、どの分岐にも使わん。
4. 次の唯一の実弾 = B: shouldInjectEroticAnchor（[[route]].ts:1387-1391）から isVeryLongResponse を外す。既定 medium の erotic/climax は isLongResponse=true（route-context.ts:4528-4532）なので焚かれる。同じ commit で TARGET_VERY_LONG_CHARACTER_IDS も外す（CI には効かんが磯貝さんの自作キャラへ届かせるのが product 側の本題）。1 コミット revert。prompt が伸びるので 1 ターン秒を転記し、medium の壁に当たったら落とす。
5. モデルは pin する。件名 [erotic-model:deepseek/deepseek-chat]（dogfood-arm.yml:97,120 の既存口、コード変更ゼロ）。medium の erotic/climax は euryale が一次（route-context.ts:1345-1358、LATE_TURN_START=22 で 10 ターンでは late-turn に入らん）で、実測は t7–t10 16 ターンが deepseek 10 / qwen 4 / euryale 2 の籤引きやった。「退避 → euryale」は向きが逆やった。
6. 基準線は HEAD から pin 付きで 2 run 焼く。ci50 は同一ビルド（afff85f5..6ea9e328 が 1 commit）やが pin 無し。ci47 は 9801781a・afff85f5（反復リトライ経路 123 行）の前なので検定の分母に入れん（band も ci47 1/4・2/4 対 ci50 0/4・0/4 で割れとる）。
7. rubric の当て方（ci65 最大の失敗。腕名の見えるまま俺が散文で書いた）: (1) blind_copy.py を script/bench/ へ commit し B 2 run + 基準線 2 run を盲検化 (2) ○/× は t8・t9 に付け引用必須 (3) ○ には反証を 2 本当て、2 本とも崩せんかった時だけ成立 (4) 移送は絶対 ○ やのうて対比（B 側の ○ が基準線側より多い）。47 会話で絶対 ○ の生き残りは 0/47。
8. 表2#2 の「最大 2 ターン」は 10 ターン窓の運用。2 ターン窓では使えん。t8・t9 のどちらかに反復 × があればその run は表2 ×。
9. (b) 前進は人手で当てる（機械実装と切り離す）: 各ターンで部位・体液・動作のうち t7 以降そのターンより前に出てへん語を 1 つ以上、本文から引用できること。書けんターンは ×。§3 の「間に合わんかったら消す」は (a) だけに限る。
10. band は記述専用。AUC 0.85 の正解ラベルは反証で 6 本とも崩れた「渡せる」で生き残り 0 やから外的妥当性は無い。残す理由は課金 0 と単位が定義済みなだけ。POL 末尾へ っ ッ 、 ー を足す（基準線 4 run も ci65 2 run も出力不変を確認済みの、事前の保険）。
11. 記録の訂正: §1 と doc:640 の引用を出荷本文へ逐語で直す（括弧書き「(a polite-speech character stays polite…)」が抜けとる）。§4 の表へ ci47 2 行と ci65 2 行を足し、commit sha（ci65=6ea9e328、ci50=afff85f5）を手で書く。summary json に sha が無いので今回は手書きしか無い。
12. 時間割は実績で: T0 = arm を焼いた時刻。ci65 は push 09:15:32 UTC → 結果読了 09:34:55 UTC の 19 分、1 run の生成は 4.7〜8.6 分・20 call。機械に 4 時間枠は要らん。律速は読解（盲検 4 本＋反証）で T0+1〜3h。
13. 予算: 1 run = 20 call × COST_PER_CALL_CENTS 10 = planned 200 cents。VLONG_BUDGET_CENTS=500 は ABORT 線で見込みやない。B 2 + 基準線 2 + 撮り直し 2 = 6 run で planned 1,200 cents（$12）。実額は CI ログの `= ~N cents, planned ~M` から転記。
14. live: live1・live2 とも新規会話・同キャラ・同時間帯・芯 6 行は同一（草案は B を焼く前に貼る）。live は pin せん（本番を測る）。transcript・generation_model・段を残す。CI と live が食い違ったら live を採る。B が間に合わんかったら live1 は既定で撮る。live1 が × なら即 revert し live2 は既定で撮る。
15. B も (ii)(b) × なら: 次は climax の見本の密度と段階指定、次いで出力契約。台は替えん。撮り直し 4 本を使い切ったら「48h では読めん」と書いて live を既定で撮る。
16. 反省（追加）: 事前登録の中止条件を、既発射データで定数やと分かる指標に置いた。主計器を宣言しながら当てずに散文で結論を出した。判断材料を持っとるのに二択を局長へ投げた。
## 17. 4 周目で残った 4 点の取り込み

- **モデル pin の効き目**（ATK-R4-3）: `[erotic-model:…]` は erotic/climax 枝の一次だけを固定する（`route-context.ts:1348-1358`）。拒否リトライと退避（fallbackLimit=1・MODEL_FALLBACKS）では外れる。実測で pin 済み 4 run 中 2 run の t8 が外れた。**run は捨てん。** t7–t10 の各ターンについて servedPhase・servedModel・refusalDetected・refusalRetryCount・regenerateCount を summary から表へ転記し、t8 の拒否有無で B 側・基準線側を層別して比べる。捨ててええのは機構的失敗（error≠null か visibleChars=0）だけ。判定窓は「t8・t9」やのうて「servedPhase=climax のターンとその 1 つ前」で定義する（段のずれに強い）。
- **反証は著者が撃たん**（ATK-R4-2）: 盲検コピー 4 本（B 2・基準線 2）と ○ を付けた理由を、別プロセス（Codex read-only / 無ければ別モデルの refuter 2 本）へ「この ○ を崩せ、既定は間違っとる」で渡す。本文の引用で崩れたら ○ 取り消し。**移送は B 2 本とも ○ かつ基準線 0 本の時だけ。** 1-0・1-1・2-1 は「この本数では読めん」として live1 は既定で撮る。mapping.json は 4 本の ○/× と反証結果を書き切るまで開かん。
- **B の定義**（ATK-34）: `shouldInjectEroticAnchor` から isVeryLongResponse と TARGET_VERY_LONG_CHARACTER_IDS を外し、**`lengthUserReinforcement` の medium 側（else 分岐）にも `${characterEroticAnchor}` を差し込む**（very_long 側だけ差しても既定 medium には届かん）。1 コミット revert。**焚く前の pre-flight**: medium・phase=climax・char-koharu-ex で組んだプロンプト本文に「[キャラ固有情報（最優先）]」が含まれることをテストで確認してから run を発射する。含まれてへんかったら焚かん。
- **絶対時刻**（E-R4-3）: live1 = **2026-09-06 09:00 JST**（磯貝さんが起きて最初に取れる枠の仮置き。違えば 1 行で直す）。B の発射締切 = live1 − 4h = **2026-09-06 05:00 JST**（焼き 1h + 盲検読解と反証 2h + PR・CI・merge・Pages 確認 1h）。T0 はこの締切から決まる従属変数。間に合わんかったら live1 は既定のまま撮る。

## 18. 今日撃つ順（old、1 push 1 コミット、件名タグ完全一致を目で確認）

1. 基準線: HEAD（climax 注記込み）× `[arm][erotic-model:deepseek/deepseek-chat]` × 2 run。
2. B: 上の 2 箇所 + pre-flight テスト × 同タグ × 2 run。
3. 盲検 4 本 → ○/× と引用 → 反証 → mapping を開く → 表へ三つ組と層別を貼る。
4. B 2 本とも ○ かつ基準線 0 → main へ PR → merge → Pages → live1 に載せる。それ以外 → live1 は既定。
