-- imageMeta: AI vision で avatar PNG から抽出した正規外見記述 (JSON)
-- profile avatar と /api/image 生成画像の一致のために anchor として使う
ALTER TABLE character ADD image_meta text;
