# Ouse フルリデザイン — ハンドオフ / 復帰アンカー

Claude Design プロジェクト `61b23298` のフルリデザインを adult-ai-app 全体へ pixel-perfect 実装するための、
アカウント非依存・死亡耐性の起点ドキュメント。**別アカウント / Codex / Devin はこのファイルだけ読めば続きを再開できる。**

## この設計で何を作るか（真のニーズ）

月額課金のエロアプリに金をかけずに抜ける質のものを自作する。Claude Design で作った新ビジュアルアイデンティティを
アプリ全体（Create Flow / Chat / ハブ各画面）へ忠実実装し、今夜 adult-ai-app で抜ける状態にする。

## 脱gated化された設計データ（このリポジトリ内に静的存在）

zip bundle を `handoff/` 配下に完全展開済み。claude.ai アカウントが無くても `git clone` だけで全設計が閲覧できる。

| パス | 内容 |
|---|---|
| `handoff/README.md` | Claude Design が生成した coding-agent 向け指示（最優先で従う） |
| `handoff/project/Create Flow Explorations.dc.html` | **起点。最初に全読み → imports を全部辿る**（局長が開いていた＝優先度高） |
| `handoff/project/Chat Screen Explorations.dc.html` | Chat 画面の設計ソース |
| `handoff/project/_ds/adult-ai-app-ui-kit-.../_ds_bundle.css` | **デザインシステム本体（トークン）**。ハードコード hex 禁止、ここのトークンを `OU2.*` にマッピング |
| `handoff/project/_ds/.../_ds_bundle.js` | デザインシステム JS |
| `handoff/project/assets/{rei,shino}.png` | キャラ画像アセット |
| `handoff/project/screenshots/{v2,v3,v2-convo,explorations}.png` | 参照スクショ（寸法はソース直読み優先、screenshot 依存しない） |
| `handoff/project/uploads/*.png` | アップロード素材 |

## 実装ルール（`handoff/README.md` の厳守事項）

1. **`Create Flow Explorations.dc.html` を最初に全読み → imports を全部辿る**。
2. **prototype をブラウザ render / screenshot するな**。寸法・色・レイアウトは HTML/CSS ソースに全記載 → 直読み。
3. prototype の内部構造をコピーせず、視覚出力を pixel-perfect に一致させる（React / 現構成に落とす）。
4. 390px モバイル優先・レスポンシブ。
5. 各画面 boot-smoke green（白画面化しない）を確認してから次へ（build-one-confirm-one）。
6. 曖昧なら実装前に局長確認。

## live 同期経路（将来の再インポート用）

- claude_design MCP: `https://api.anthropic.com/v1/design/mcp`（`/design-login` 認証）
- import URL: `https://claude.ai/design/p/61b23298-7a5b-40c0-ab7b-1b2f3c3bb232?file=Create+Flow+Explorations.dc.html`

> 注意: この MCP / import は特定 claude.ai アカウント限定。**アカウントが使えない場合は上記 `handoff/` 配下の静的ソースを正とする**（脱gated の主眼）。

## P1 実装の進め方

起点＝ Create Flow（`src/component/character/ou-create-scenario.tsx` 等）→ Chat → ハブ各画面（Phase 2 は #726 の5画面群）。
画面ごとに pixel-perfect 実装し、boot-smoke（`scripts/boot-smoke.mjs`）green を確認してから次へ。

## 関連

- 旧設計プロジェクト `3e6b2653` の資料は `README.md` / `PRODUCT_MEMO.md` / `ouse-conversation-screen.html`（別イテレーション）。
- 本番 main は白画面化していない（#708 修正済 + boot-smoke #712 CI 配線済）。
