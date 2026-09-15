-- 地の文の壁（<action> が画面上で 8〜13 行続く）のプロンプト側。
--
-- prompt-variant-defaults.ts を直しても、実際に配られるのは D1 の prompt_variant 行。
--
-- 実測（phase36・20 ターン）でブロックの組数がフェーズごとに割れとった:
--   conversation 2〜3 / intimate 3〜5 / erotic 1 / climax 1〜2 / afterglow 3〜4
-- erotic と climax だけ潰れる。前後のフェーズは同じ雛形で交互に書けとる。
--
-- 雛形が 2 種類同時に届いとったのが原因。user 発言の直前へ差される lengthClosingRule は
-- action と dialogue を交互に並べた形を見せとるのに、system 側のこの本文は
--   <action> 1 個 → <dialogue> 1 個 → <inner> 1 個
-- の 1 組しか見せてへん。しかも <action> の説明だけ 7 行で感覚義務まで付いとって、
-- <dialogue> は 1 行。厚くする義務が付いとる方の雛形が 1 組やと、長さを稼ぐ先は
-- <action> しかなくなる。
--
-- 外枠の見本を 2 サイクルへ書き直したら 16 ターン全部が交互になった実績が既にある
-- （台帳 C16 / b569d1a2）。効く形は分かっとるので、こちらの雛形も同じ形へ揃える。

UPDATE prompt_variant
SET body = REPLACE(
  body,
  '<dialogue>
「セリフ」をここに。必ず日本語の鉤括弧「」で囲む。キャラの口調・語尾を厳守。
</dialogue>
<inner>
キャラの内心、本音、葛藤。口に出さない感情。
</inner>
</response>',
  '<dialogue>
「セリフ」をここに。必ず日本語の鉤括弧「」で囲む。キャラの口調・語尾を厳守。
</dialogue>
<action>
場面が進んだぶんをここに書く。<action>と<dialogue>は必要なだけ交互に繰り返し、1つのタグへ段落を積み上げん。
</action>
<dialogue>
続きのセリフ。
</dialogue>
<inner>
キャラの内心、本音、葛藤。口に出さない感情。<inner>は最後に1つだけ。
</inner>
</response>'
)
WHERE body LIKE '%「セリフ」をここに。%';
