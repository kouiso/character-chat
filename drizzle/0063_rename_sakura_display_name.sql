-- Sakura の表示名・system_prompt 内の名前表記を「さくら」に統一
UPDATE character
SET
  name = '桜庭 さくら',
  greeting = REPLACE(greeting, '小春', 'さくら'),
  system_prompt = REPLACE(system_prompt, '小春', 'さくら')
WHERE id IN ('default-character', 'char-koharu-ex');
