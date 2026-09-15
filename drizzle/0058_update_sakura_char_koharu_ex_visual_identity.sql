-- #1110: char-koharu-ex の外見を sakurakoharu LoRA 10点レシピの身元タグに合わせる。
-- 既存の visual_prompt / image_meta / system_prompt 内の chestnut hair 表記を修正。
UPDATE character
SET
  visual_prompt = 'long wavy honey-blonde hair, blue eyes, flower hair ornament, medium breasts, subtle makeup, wedding ring, adult elegance, 29 years old',
  image_meta = json_object(
    'appearance', 'long wavy honey-blonde hair, blue eyes, flower hair ornament, medium breasts, subtle makeup, wedding ring, adult elegance, 29 years old',
    'artStyle', 'soft anime illustration, warm lighting',
    'outfit', ''
  ),
  system_prompt = REPLACE(
    system_prompt,
    '肩くらいのチェスナットカラーのヘア、控えめなメイク、大人の洗練さ。',
    'ロングウェーブの蜂蜜色ブロンド髪、青い目、花の髪飾り、控えめな胸、大人の洗練さ。'
  )
WHERE id = 'char-koharu-ex';
