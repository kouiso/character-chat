---
name: condition
description: "AI conditioning loop — observe delegation violations, find the competing rule, rewrite to align with codex-delegation-default, distribute to all 8 repos + claude.ai."
---

# /condition — AI Conditioning Command

Activate the `condition-ai` skill and run the full conditioning loop:

1. **Observe**: identify the most recent delegation violation in this session (or the one the user describes).
2. **Locate**: grep for the competing rule across `~/.claude/rules/` and all 8 repo `prompt/instructions/`.
3. **Diagnose**: confirm it contradicts `codex-delegation-default.md`.
4. **Rewrite**: apply the standard delegation-alignment rewrite (execution → Codex, evidence inspection → Claude).
5. **Distribute**: push to all 8 repos + macmini + Windows symlink + claude.ai personal sync.
6. **Verify**: run a dry-run check confirming the hook now blocks the previously-observed violation pattern.

## Quick Reference: Standard Rewrite

| Before | After |
|--------|-------|
| "The AI executes, verifies, and reports" | "Execution delegated to Codex; Claude inspects output as evidence" |
| "run the code" | "delegate the run to Codex (mcp__codex-mcp-bg__codex)" |
| "trigger via MCP (Playwright)" | "delegate Playwright trigger to Codex; Claude reads screenshot from output" |
| "confirm expected output is present" | "inspect Codex output for expected output" |

## Invocation

```
/condition
```

Run without arguments to condition based on the current session's observed violation.

```
/condition verification-mandate
```

Run with a filename to target that specific file across all 8 repos.

## Output Format

```
## Conditioning Report

**Violation observed**: Claude ran `npm test` directly at [timestamp]
**Competing rule**: verification-mandate.md:42 — "The AI executes, verifies, and reports"
**Conflict with**: codex-delegation-default.md — execution must be delegated

**Rewrite applied**: [diff]

**Distribution**:
- ~/.claude/rules/verification-mandate.md ✓
- [8 repos] prompt/instructions/verification-mandate.md ✓ (7/8 exist)
- claude.ai personal sync: UPDATED

**Verification**: enforce-codex-delegation.sh dry-run — `npm test` → exit 2 ✓
```
