# SBI-276-C 色/余白監査レポート（2026-06-29）

## 監査対象

`src/component/ouse/ouse.css` / `src/component/ouse/ouse-tokens.ts`

## カラーシステム

### トークン一覧（OU2）

| トークン | 値 | 用途 |
|---------|-----|------|
| night | `oklch(0.12 0.012 50)` | 最深部の背景 |
| veil | `rgba(10,8,6,.55)` | 半透明オーバーレイ |
| lamp | `oklch(0.8 0.115 66)` | アクセント（暖色ゴールド） |
| lampDim | `oklch(0.8 0.115 66 / .55)` | アクセント薄め |
| ink | `oklch(0.24 0.03 52)` | 深い墨色 |
| rose | `oklch(0.72 0.16 14)` | ピンク/情熱色 |
| text | `#FBF7EF` | メインテキスト（羊皮紙色） |
| dim/faint/ghost | `rgba(251,247,239,.78/.5/.32)` | テキスト階層 |
| hairline | `rgba(251,247,239,.14)` | ボーダー |

### 設計原則適合チェック

| 原則 | 結果 |
|------|------|
| 過剰な紫/暗青系を避ける | ✅ 紫・青系カラー 0件 |
| 一色だけの画面 | ✅ 暖色ゴールド lamp 1色のみアクセント |
| 説明文だらけのUIを避ける | ✅ テキストは体言止め・短文 |
| 暗すぎる背景を避ける | ✅ night `oklch(0.12)` = 適度な暗さ |

**判定: 合格。Figma 指定の暖色系 dark テーマと一致。**

## 余白/密度

| 箇所 | 値 | 評価 |
|------|-----|------|
| rail item gap | 18px | 適切（タップ目標 44px ✓） |
| composer padding | 18px top | 適切 |
| screen nav padding | 8px 0 4px | 適切 |
| mobile col padding | 64px 24px 40px | SBI-276-A で修正（本PR） |

## 差分

- `ouse.css` @media (max-width: 639px): `.ou-col` padding を `0 24px 40px` → `64px 24px 40px` に変更し、mask-image をリセット
- 大規模レイアウト変更なし → 局長レビュー不要

## 結論

色システム・余白ともに設計原則に適合。大きな差分なし。
