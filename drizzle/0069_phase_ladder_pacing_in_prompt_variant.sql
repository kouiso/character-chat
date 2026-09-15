-- A5 / C3 (doc/backlog-2026-08-17.md)。局長「まだ胸の段やのに手マンに入る」
-- 「1チャットで勝手に話の展開が進んでませんかね？」のプロンプト側。
--
-- prompt-variant-defaults.ts を直しても、実際に配られるのは D1 の prompt_variant 行。
--
-- scene_response_structure と conversation_xml_hint は同じ [Phase progression guideline] を
-- 持っとって、そこでは
--   - user_msg に親密・性的キューがあれば、対応する phase へ MUST escalate する。
-- が、2 行下の
--   このフェーズを最低2ターン維持すること。急いで erotic に飛ばない。
-- より先に置かれとった。同じブロックの中で MUST が「維持すること」を上書きするので、
-- 急がん要件は最初から負けとる。指示を足しても勝たん。
--
-- 段の一覧そのものも落とす。今どの段におるかはこの本文に書いてへん——段と天井は
-- augmentMessages が最後のユーザー発言の直前へ差す SCENE_CONTEXT_MESSAGES / PHASE_CEILING が
-- 渡しとる。17,000 字の system の真ん中に先の段のレシピを置いて、末尾で天井を言う形やった。
-- 実際 SCENE_CONTEXT_MESSAGES.erotic は
--   Ignore any earlier prompt that describes erotic as 'clothes off / fingertip stimulation ...'
-- という打ち消しを持っとって、この一覧を末尾から否定しとる。打ち消される側を消す。
--
-- 削除であって置換やない。急がん要件は platform_scene 側の同じ 2 行が持っとるので残る。
-- 「進めるな」にはせんため、明示された行動を同じ応答で完了する要求と、
-- conversation へ戻さん要求（⚠️の行）は触らん。

UPDATE prompt_variant
SET body = REPLACE(
  body,
  '- user_msg に親密・性的キューがあれば、対応する phase へ MUST escalate する。
',
  ''
)
WHERE body LIKE '%MUST escalate%';

UPDATE prompt_variant
SET body = REPLACE(
  body,
  '- intimate: 距離が近づく描写、触れる、抱きしめる、息遣いが混ざる、触れられたがる
- foreplay (焦らし): キスの延長、服の上から触る、手を導く、焦らすように止める、「まだ？」と聞く。
  このフェーズを最低2ターン維持すること。急いで erotic に飛ばない。
- erotic: 肌・衣服を解く、指先の刺激、腰がくねる
- climax: 絶頂・達する
- afterglow: 事後の余韻・息が整う・タオル・水・休む・寄りかかる
',
  ''
)
WHERE body LIKE '%- intimate: 距離が近づく描写%';
