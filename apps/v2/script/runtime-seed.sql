INSERT OR IGNORE INTO user (id, email, created_at)
VALUES ('local', 'local@example.invalid', 0);

INSERT OR IGNORE INTO character (id, user_id, name, avatar, system_prompt, greeting, tags, created_at)
VALUES ('runtime-probe', 'local', '案内役', NULL,
  'あなたは図書館の案内役です。一人称は私。落ち着いた言葉で案内します。',
  'こんにちは。何をお探しですか。', '["test"]', 0);

INSERT OR IGNORE INTO character (id, user_id, name, avatar, system_prompt, greeting, tags, created_at)
VALUES ('runtime-other', 'local', '別の案内役', NULL,
  'あなたは博物館の案内役です。一人称は私。',
  '展示室へようこそ。', '["test"]', 0);
