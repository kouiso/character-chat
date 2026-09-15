-- 生成時パラメータの完全記録（局長指示 2026-07-13: 「今後作った時のパラメータとかモデルも別途カラムを作ってDBに入れる」）。
-- strength/steps/sampler/guidance/サイズ/2段構成/提供元 等を JSON で保存し、タッチ再現・モデル追跡を可能にする。
ALTER TABLE `image_review` ADD COLUMN `gen_params` text;
ALTER TABLE `character_sub_image` ADD COLUMN `gen_params` text;
