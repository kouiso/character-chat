# Token Optimization Pre-Mortem

## Current Data

| Layer | Bytes | Notes |
|-------|-------|-------|
| Global rules (`~/.claude/rules/`) | 60,011 | `codex-delegation.md` alone was 26,481 bytes in the source session |
| Project CLAUDE.md layers | ~8,000 | Context routing was duplicated across files |
| Project instructions (`prompt/instructions/`) | ~6,000 | Some rules were also loaded via symlink |
| Memory files | ~4,000 | Several project memory files load each session |
| Estimated total | ~78,000 | Roughly 20K tokens can be spent before task work begins |

## Scenario A: Token Exhaustion Stops Work

Probability: High.
Impact: High.

Observed causes:

| # | Pattern | Estimated Cost | Frequency |
|---|---------|----------------|-----------|
| 1 | Rule bloat, especially long delegation guidance | ~6,500 tokens/session | Every session |
| 2 | Cascading reads from "just checking one file" | 2,000-10,000 tokens | High |
| 3 | Large search output streamed into context | 5,000-50,000 tokens | High |
| 4 | Re-reading the same context after compaction or handoff | 1,000-3,000 tokens | Medium |
| 5 | Overusing subagents for single targeted lookups | 3,000-8,000 tokens | Low |
| 6 | Duplicated top-level CLAUDE.md content | ~2,000 tokens | Every session |

Mitigations:

1. Compress oversized rule files; keep the always-loaded rule surface small and move detailed rubrics into opt-in skills.
2. Use targeted `rg`, `sed`, and `git diff` before opening whole files.
3. Prefer summarized command output for exploration and cap search output aggressively.
4. Track what has already been read in the current turn before re-reading.
5. Use subagents only for explicit parallel work or genuinely separable investigations.
6. Remove duplicated project guidance where possible.

## Scenario B: Token Savings Cause Shallow Work

Probability: Medium.
Impact: Critical.

Observed causes:

| # | Pattern | Result | Frequency |
|---|---------|--------|-----------|
| 1 | Trusting a delegated completion report without checking the diff | False completion | High |
| 2 | Reporting without build, lint, or relevant tests | Broken code can ship | Medium |
| 3 | Reading only summaries when exact logic matters | Logic bugs are missed | Medium |
| 4 | Treating verification as optional token spend | UI/API defects remain | Low |
| 5 | Giving delegated agents too little task context | Rework and higher total cost | Medium |

Minimum verification checklist after delegated work:

```text
1. Read the final delegated report or last 50 log lines.
2. Check `git diff --stat` and the changed file list.
3. Run the narrowest relevant build, lint, and tests.
4. Spot-check at least one important diff hunk yourself.
```

The goal is not to minimize tokens at all costs. The goal is to spend enough context to verify the work without flooding the session.

## Structural Improvements

Immediate:

| Action | Expected Effect |
|--------|-----------------|
| Remove duplicated CLAUDE.md guidance | Lower baseline context cost |
| Keep rule files under a strict size budget | Lower startup cost |

Short term:

| Action | Expected Effect |
|--------|-----------------|
| Move long delegation rubrics into skills | Lower always-on token load |
| Standardize delegated task templates | Less rework from underspecified tasks |
| Add a small verification checklist to handoff templates | Fewer false completions |

Medium term:

| Action | Expected Effect |
|--------|-----------------|
| Warn on unexpectedly large tool output | Better visibility into token spikes |
| Record common waste patterns in concise memories | Reuse lessons without loading long docs |

## Token Budget Heuristic

| Use | Limit | Rationale |
|-----|-------|-----------|
| Always-loaded rules and instructions | 25K tokens, target 12K | Startup overhead should not dominate work |
| One task's local reasoning | ~5K tokens | Enough for spec, judgment, and verification |
| Delegated work verification | ~1K tokens | Cheap compared with false completion rework |
| User-facing update | ~500 tokens | Keep status clear and concise |

If a single task is trending far above these limits, stop and summarize what is known before reading more.
