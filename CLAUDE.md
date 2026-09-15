## Codex Cloud
**ENV_ID**: `69f3391311948191856346277f35a7d7`  — `codex cloud exec --env 69f3391311948191856346277f35a7d7 "<task>"`

**画像生成は Novita API 直・モデル固定（局長指示 2026-07-12・旧「$imagegen を Cloud で」運用は廃止）**: キャラ画像の生成は Novita API を直接叩く。モデルは `waiNSFWIllustrious_v90_1187991.safetensors` **以外使わない**。codex（Cloud / bg-MCP）経由の画像生成・macmini `$imagegen` はどちらも禁止。生成前に枚数と概算コストを局長に提示する。手順詳細: `prompt/commands/add-char-photo.md`。

## プロジェクトの存在理由

月額課金のエロアプリにお金をかけずに抜きたい。Claudeで無料で抜ける質のものを自分で作る。まず自分で使い、ポートフォリオにもなり、良ければ商用化する。

AI chat application with character personas, speech synthesis, and local-first storage.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4, shadcn/ui |
| State | Zustand |
| Local DB | Dexie (IndexedDB) |
| AI SDK | Vercel AI SDK, OpenRouter |
| Backend | Hono (Cloudflare Pages Functions) |
| DB | Cloudflare D1 (Drizzle ORM) |
| Deploy | Cloudflare Pages |
| Package Manager | pnpm |

## Commands

```bash
pnpm dev           # Start dev server (Vite)
pnpm build         # tsc -b && vite build
pnpm lint          # ESLint
pnpm dev:worker    # Cloudflare Pages local dev
task setup         # Full project setup (Taskfile)
task ci            # CI check (lint + build)
```

## Architecture

Detailed AI instructions are single-sourced in `prompt/`. Claude Code keeps its
always-loaded rules small and uses `.claude/rules/domain-routing.md` to load only
the relevant detailed instructions. GitHub Copilot receives symlinked mirrors.

| Source (single truth) | Claude Code | GitHub Copilot |
|---|---|---|
| `prompt/instructions/*.md` | Referenced on demand by `.claude/rules/domain-routing.md` | `.github/instructions/*.instructions.md` |
| `prompt/commands/*.md` | `.claude/commands/*.md` | `.github/prompts/*.prompt.md` |
| `prompt/agents/*.md` | `.claude/agents/*.md` | `.github/agents/*.agent.md` |

`.claude/rules/` contains routing, path-scoped rules, and only the minimal rules
that must remain always-on.

## Instruction System

| File | Description |
|------|-------------|
| [core.md](prompt/instructions/core.md) | Core mission, naming conventions, critical checklist |
| [persona.md](prompt/instructions/persona.md) | Neutral engineering assistant communication rules |
| [autonomous-execution.md](prompt/skills/autonomous-execution/SKILL.md) | Self-verification, zero user burden |
| [prohibitions.md](prompt/instructions/prohibitions.md) | Comprehensive prohibition rules |
| [typescript.md](prompt/skills/typescript/SKILL.md) | TypeScript type safety rules |
| [no-obvious-comments.md](prompt/skills/no-obvious-comments/SKILL.md) | Comment quality standards |
| [no-injected-ai-filter.md](prompt/instructions/no-injected-ai-filter.md) | キャラ設定に無い枠（合意・禁止語など）をプロンプトへ足さん |
| [character-sheet-design.md](prompt/skills/character-sheet-design/SKILL.md) | キャラシートの書き方。演者の層と出来事の層を分ける／症状をシート・プロンプト・コードへ当てる |
| [adversarial-review-with-codex.md](prompt/instructions/adversarial-review-with-codex.md) | 品質チェックは Codex に反証させてから結論を出す |

## Commands

| Command | Description |
|---------|-------------|
| `/bad` | Register bad behavior as prohibition |
| `/good` | Register good behavior as rule |
| `/plan` | Planning with dual proposal |
| `/debug` | Debug workflow |
| `/e2e` | E2E test execution |
| `/tdd` | Test-driven development |
| `/review-pr` | PR review |
| `/refactor-clean` | Refactoring workflow |
| `/security-check` | Security audit |

## Agents

| Agent | Description |
|-------|-------------|
| code-reviewer | Code review specialist |
| e2e-runner | E2E test runner |
| planner | Planning specialist |
| security-reviewer | Security review specialist |

## Project Structure

```
src/
  app.tsx              # Main app component
  main.tsx             # Entry point
  component/
    ui/                # shadcn/ui components
    chat/              # Chat UI (chat-view, message-bubble, chat-input)
    settings/          # Settings panel
  schema/              # Zod schemas (character, message, conversation, user)
  lib/                 # Utilities (api, db, tts-constants, utils)
  hook/                # Custom hooks (use-speech-synthesis)
  store/               # Zustand stores (chat-store, settings-store)
functions/             # Cloudflare Pages Functions (Hono)
drizzle/               # D1 migrations
```

## Conventions

- File/dir names: kebab-case singular (e.g., `chat-input.tsx`)
- Components: PascalCase (e.g., `ChatInput`)
- Variables/functions: camelCase
- Types: PascalCase with specific names (e.g., `ChatInputProps`)
- Constants: UPPER_SNAKE_CASE
- Code comments: Japanese only ("why" only, no obvious comments)
- Commit messages: English, Conventional Commits
- Docs: Japanese
