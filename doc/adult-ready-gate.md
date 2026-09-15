# Adult Ready Gate Checklist

## Purpose

この ready gate は、adult-ai-app の真の目的である「局長が月額 NSFW アプリに頼らず daily-use できる高品質チャット」を、PR ごとに証拠で判定するための acceptance contract です。

対象 issue: `#306`, `#307`, `#265`, `#276`

## 30-second BLUF

- Goal: PR/merge 数ではなく、局長が saylo 代替として戻って使える状態を証明する。
- Pass: 下記 checklist の全項目に、PR body から辿れる evidence がある。
- Block: 1 項目でも未確認、または evidence が手作業依存なら merge しない。
- Scope: この gate は #306/#307/#265/#276 の修正 PR が満たすべき証拠を固定する。runtime 修正そのものは step 2/3 で扱う。

## Zero User Burden Rule

局長に 3 人物 x 3 場面 x 10 往復の手動確認を投げない。AI/CI/Playwright/log が evidence を取得し、局長確認は最終 30 秒 demo のみとする。

Fail examples:
- DB/localStorage を手で編集しないと再現しない。
- 「何度か retry すれば動く」を成功扱いにする。
- engineer-only toggle や secret 値を知らないと通常 flow が通らない。
- 長い raw NSFW conversation log を局長や CI artifact にそのまま貼る。

## Daily-Use Checklist

PR body に各項目の evidence link、実行日時、実行者、pass/fail を記録する。

- [ ] Character selection works
  - Evidence: target character を選び、fallback hack なしで chat に入れる。
- [ ] New chat starts correctly
  - Evidence: fresh conversation 作成と first response が初回で成功する。
- [ ] Chat history resume works
  - Evidence: reload 後に prior conversation を開き、context preserved のまま続き送信できる。
- [ ] Image display is correct, no black image
  - Evidence: generated/displayed image が visible で、fully black/blank ではない。
- [ ] 10-turn conversation quality passes
  - Evidence: 1 session で 10 往復が途切れず完了する。
- [ ] No refusal or regulatory boilerplate
  - Evidence: in-scope adult flow で generic refusal, policy, regulatory wording が漏れない。
- [ ] No repetitive phrasing
  - Evidence: repeated sentence stems, loops, obvious template degeneration がない。
- [ ] Persona adherence remains stable
  - Evidence: character persona traits and scene assumptions が 10 往復で崩れない。
- [ ] Zero User Burden satisfied
  - Evidence: 局長手動確認ではなく AI/CI evidence で再現できる。

## Multi-Angle Gate

| Angle | Required evidence |
|---|---|
| Implementation | gate 項目が deterministic script/test または既存 package script に接続されている。 |
| Security/privacy | secret、API key、raw NSFW logs、prompt injection 経路、外部送信先を確認し、PR/artifact へ過剰ログを残さない。 |
| Performance | streaming latency、retry 回数、token overuse、10-turn completion time の異常を記録する。 |
| UX | 390px mobile と desktop で character selection、history resume、image display、input/error state を確認する。 |
| Maintainability | checklist 名を固定し、issue/PR/evidence で再利用できる形にする。 |
| Backward compatibility | Dexie/local-first conversation、existing character schema、prompt assets、saved history を壊さない。 |
| Test | `pnpm test` と `pnpm build` を最小必須にする。e2e が secret/環境不足なら blocker と代替 test を記録する。 |
| Operations | PR body に command、timestamp、environment、known blocker、30-second BLUF を残す。 |
| Rollback | runtime 変更を含む場合は revert 可能な commit 単位に分け、rollback 手順を PR に書く。docs/test only なら runtime rollback impact is none と明記する。 |
| Monitoring | merge 後に CI、open issue state、Cloudflare deploy URL、daily-use smoke の確認欄を更新する。 |

## Premortem

| Failure | Detection | Mitigation |
|---|---|---|
| Spec change mixes #306/#307/#265/#276 into one unfocused PR | diff が gate 以外に広がり、completion condition が曖昧になる | step 1 は gate 固定のみ。history resume は step 2、quality/model/UI は step 3 に分離する。 |
| API compatibility breaks OpenRouter/Vercel AI SDK/Cloudflare behavior | e2e に 429, model unavailable, binding error が出る | API 実測は step 3 matrix で扱い、step 1 gate は API 非依存 test を先に置く。 |
| Environment drift between local, cloud, and CI | local pass / CI fail、Node/pnpm/wrangler 差異 | `packageManager` と package scripts のみ使い、environment を PR body に記録する。 |
| Race condition in streaming, history save, or image load | reload/resume/send、10-turn、image check で flake する | race を pass 扱いにせず、再現手順と screenshot/log を blocker にする。 |
| Regression reintroduces black image, refusal copy, repetition, or lost history | ready checklist が未記入の PR | checklist 未完了なら merge blocked。 |
| User misoperation shifts burden to局長 | PR comment が局長に長時間確認を依頼している | AI/CI が evidence を取る。局長は 30 秒 demo のみ。 |
| Side effect from unrelated runtime changes | docs/test gate の PR に app source diff が混ざる | step 1 は docs/test/script 中心。runtime diff は別 PR に分ける。 |
| Security hole leaks NSFW logs or secrets | PR/artifact に raw sensitive text、API key、prompt secret が載る | log redaction、synthetic excerpt、secret scan を使い、必要最小 evidence にする。 |
| Performance stall consumes excessive tokens/time | long e2e が rate limit、timeout、cost spike | smoke/deterministic test を先行し、long safe は step 3 で分離実行する。 |
| Bot or CI feedback is ignored | CodeRabbit/GitHub checks が pending/fail/commented のまま | `gh pr checks` と review comments を merge gate にする。 |

## Required Commands

Minimum:

```bash
pnpm test
pnpm build
```

When environment/secrets allow:

```bash
pnpm e2e:smoke
pnpm e2e:long:safe
tsx script/test-xml-quality.ts A 3
tsx script/test-xml-quality.ts B 3
tsx script/test-xml-quality.ts C 3
```

## Evidence Path Convention

Store each gate report at:

```text
e2e-results/adult-ready-gate-YYYYMMDD.md
```
