-- 4-5往復程度しかない短いチャット履歴やゴミデータを整理する。
-- 対象は sukererion@gmail.com のみ。1日以内に作成されたものは進行中の可能性があるので除外。
-- メッセージ < 6 件 (= 約2.5往復未満) を「短い」と定義し、関連 message 行も合わせて削除する。
-- 依存テーブル (scene_bookmark, conversation_share, comic, message) を conversation 削除前に掃除する。
-- Cloudflare D1 は CREATE TEMP TABLE 禁止 (SQLITE_AUTH) のため、サブクエリを毎回再評価する形に展開。

-- 「短い & 古い & 対象ユーザー」会話の id を判定するサブクエリは複数回現れるが、D1 は副作用順序が
-- 保証されないため message 削除前に conversation を消すと判定不能になる。よって削除順を厳守:
-- scene_bookmark -> conversation_share -> comic -> message -> conversation の順。

DELETE FROM scene_bookmark
WHERE conversation_id IN (
  SELECT c.id FROM conversation c
  WHERE c.user_id = 'sukererion@gmail.com'
    AND c.created_at < (strftime('%s','now','-1 day') * 1000)
    AND (SELECT COUNT(*) FROM message m WHERE m.conversation_id = c.id) < 6
);
--> statement-breakpoint

DELETE FROM conversation_share
WHERE conversation_id IN (
  SELECT c.id FROM conversation c
  WHERE c.user_id = 'sukererion@gmail.com'
    AND c.created_at < (strftime('%s','now','-1 day') * 1000)
    AND (SELECT COUNT(*) FROM message m WHERE m.conversation_id = c.id) < 6
);
--> statement-breakpoint

DELETE FROM comic
WHERE conversation_id IN (
  SELECT c.id FROM conversation c
  WHERE c.user_id = 'sukererion@gmail.com'
    AND c.created_at < (strftime('%s','now','-1 day') * 1000)
    AND (SELECT COUNT(*) FROM message m WHERE m.conversation_id = c.id) < 6
);
--> statement-breakpoint

DELETE FROM message
WHERE conversation_id IN (
  SELECT c.id FROM conversation c
  WHERE c.user_id = 'sukererion@gmail.com'
    AND c.created_at < (strftime('%s','now','-1 day') * 1000)
    AND (SELECT COUNT(*) FROM message m2 WHERE m2.conversation_id = c.id) < 6
);
--> statement-breakpoint

-- 最後に conversation 本体を削除。直前で message を消したので COUNT(*)=0 になり、
-- < 6 の条件は引き続き真。user_id + 1-day cutoff は同じガードで保護されている。
DELETE FROM conversation
WHERE user_id = 'sukererion@gmail.com'
  AND created_at < (strftime('%s','now','-1 day') * 1000)
  AND (SELECT COUNT(*) FROM message m WHERE m.conversation_id = conversation.id) < 6;
