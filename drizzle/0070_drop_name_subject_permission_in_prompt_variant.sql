-- 地の文（<action>）が三人称の小説調になる件。
--
-- prompt-variant-defaults.ts を直しても、実際に配られるのは D1 の prompt_variant 行。
--
-- 相反する 2 つの指示が同時に届いとった:
--   許可側: scene_response_structure の「キャラ名主語、主語省略、一人称体感のいずれも可」
--   禁止側: few-shot 見本 3 本の「(third-person narration — BANNED)」と
--           quality-guard の checkNoThirdPersonNarration（キャラ名主語 2 個以上で撮り直し）
-- 同じ書き方を一方が許可し、もう一方が撮り直させとる。撮り直しは 1 回 30〜40 秒かかるうえ、
-- 本体プロンプトからは同じ許可が届き続けるので、モデルは同じ書き方へ戻る。
--
-- 指示を足しても勝たん（実測で 2 回負けとる）。勝っとる側の許可を削る。
-- 削除であって置換やない。禁止側の signal は few-shot に既に在るので、
-- 許可が消えれば通る。<dialogue>/<inner> の一人称指定は元から別に在るので触らん。

UPDATE prompt_variant
SET body = REPLACE(
  body,
  'キャラ名主語、主語省略、一人称体感のいずれも可。',
  '主語省略、一人称体感のいずれも可。'
)
WHERE body LIKE '%キャラ名主語%';
