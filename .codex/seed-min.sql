-- .codex/seed-min.sql — minimal offline seed for the Codex Cloud container.
--
-- Why minimal: the full `pnpm db:seed` (script/seed.ts) uploads avatars to
-- REMOTE R2 (`wrangler r2 object put` without --local) which needs Cloudflare
-- auth and network — impossible in the offline container. This file seeds just
-- enough (one user + character + conversation + message) for DB-dependent
-- integration tests to have real rows to read.
--
-- Base-schema columns only (guaranteed present after every migration is applied).
-- Idempotent: INSERT OR REPLACE, safe to re-run. No R2, no network.

INSERT OR REPLACE INTO user (id, email, created_at)
  VALUES ('sukererion@gmail.com', 'sukererion@gmail.com', 1735689600000);

INSERT OR REPLACE INTO character (
    id, user_id, name, avatar, system_prompt,
    lora_model, lora_weight, lora_trigger_prompt,
    greeting, tags, created_at
  )
  VALUES (
    'char-codex-sample',
    'sukererion@gmail.com',
    'Codex Sample',
    NULL,
    'You are a sample character used only for local integration tests.',
    'aiadultapp:testlora@1',
    0.85,
    'testlora, 1girl, sample character',
    'Hello from the Codex container seed.',
    '["sample","codex"]',
    1735689600000
  );

INSERT OR REPLACE INTO conversation (id, user_id, character_id, title, created_at, updated_at)
  VALUES (
    'conv-codex-sample',
    'sukererion@gmail.com',
    'char-codex-sample',
    'Codex sample conversation',
    1735689600000,
    1735689600000
  );

INSERT OR REPLACE INTO message (id, user_id, conversation_id, character_id, role, content, created_at)
  VALUES (
    'msg-codex-sample-1',
    'sukererion@gmail.com',
    'conv-codex-sample',
    'char-codex-sample',
    'assistant',
    'Seeded message for DB-dependent integration tests.',
    1735689600000
  );
