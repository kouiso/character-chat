-- 既存 production の sakura / downer キャラに LoRA 設定を追加する。
-- 0051_character_lora.sql でカラムを追加済みの前提。
-- 値は Runware で実測済みのLoRAレシピ。
UPDATE character
SET
  lora_model = 'aiadultapp:sakurakoharu@1',
  lora_weight = 0.85,
  lora_trigger_prompt = 'sakurakoharu'
WHERE id = 'char-koharu-ex';

UPDATE character
SET
  lora_model = 'aiadultapp:downerojou@3',
  lora_weight = 0.85,
  lora_trigger_prompt = 'downerojou'
WHERE id = 'import-charap-ダウナーお姉さんに拾われる話';
