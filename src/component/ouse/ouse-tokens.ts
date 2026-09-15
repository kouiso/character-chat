export const OU2 = {
  night: "#140f0d",
  nightMid: "#1b1512",
  barBg: "#160f0d",
  veil: "rgba(27,21,18,.55)",
  lamp: "#d6a957",
  lampDim: "rgba(214,169,87,.55)",
  // 設計正準の灯芯ゴールド。既存承認済み OU2.lamp とは別値（据え置き、退行防止）
  lampGold: "#d6a054",
  lampGrad: "linear-gradient(145deg,#f0d18a,#d6a054)",
  onLamp: "#2a1c0c",
  accent: "#f0dcae",
  accentSoft: "#fbf3e4",
  labelMuted: "#b79766",
  // 設計 D-frame の明るいアクセント金（lamp より明るい。glyph・progress fill・pill 文字・ビューア操作アイコン）
  goldBright: "#e7c987",
  // 全画面ビューア（2e）専用トーン。near-black 背景＋上下 scrim＋glass 円ボタン
  viewerBg: "#0d0a08",
  viewerScrimTop: "linear-gradient(180deg,rgba(13,10,8,.8),rgba(13,10,8,0))",
  viewerScrimBottom: "linear-gradient(0deg,rgba(13,10,8,.92),rgba(13,10,8,0))",
  viewerGlass: "rgba(13,10,8,.5)",
  logoInk: "#171210",
  logoFlameLight: "#f4dfa4",
  logoFlameSolid: "#b08545",
  ink: "#2c2522",
  rose: "oklch(0.72 0.16 14)",
  roseA: "oklch(0.66 0.22 352 / 0.14)",
  text: "#f3ead9",
  dim: "rgba(243,234,217,.78)",
  faint: "rgba(243,234,217,.5)",
  ghost: "rgba(243,234,217,.32)",
  hairline: "rgba(243,234,217,.14)",
  // 失敗・オフライン等の警告トーン（設計 C-2/C-3/D-2 の暖色レッド）
  warn: "#d69a7c",
  warnText: "#e0b09a",
  warnBorder: "rgba(210,120,80,.4)",
  warnBg: "rgba(120,60,40,.14)",
  warnBgStrong: "rgba(120,60,40,.22)",
  readShadow: "0 1px 2px rgba(6,4,3,.62), 0 3px 20px rgba(6,4,3,.55)",
  // デザイン意図に合わせ Noto Serif JP を優先（従来は Shippori Mincho が先頭だった）
  serif: "'Noto Serif JP','Shippori Mincho',serif",
  round: "'Zen Maru Gothic',sans-serif",
  mono: "'JetBrains Mono',monospace",

  // --- 案A「燈」チャット画面 redesign 用の追加トークン ---
  avatarRing: "rgba(201,180,140,.4)", // ヘッダー丸ボタンの枠線
  hairlineWarm: "rgba(201,180,140,.28)", // ヘッダー下の区切り線
  chrome: "#b79766", // 戻る矢印・シーン区切り罫のアクセント
  chromeDim: "rgba(183,151,102,.5)", // シーン区切り罫線
  headerName: "#f1e7d6", // ヘッダーの相手名
  subtitle: "#9a8a6f", // ヘッダーの関係性表示・丸ボタンの記号色
  headerAction: "#c9b48c",
  nameTag: "#cda86a", // メッセージ内の話者名ラベル
  label: "#8a7f6c", // 「あなた」ラベル・再生成/ページャの補助テキスト
  bubbleBorder: "rgba(201,180,140,.3)", // ユーザー吹き出しの枠線
  bubbleGradA: "rgba(214,169,87,.24)",
  bubbleGradB: "rgba(176,125,58,.18)",
  pillBorder: "rgba(214,169,87,.45)", // 画像生成ピルの枠線
  pillText: "#e7ba6a", // 画像生成ピルの文字色
  sendGradA: "#d6a957",
  sendGradB: "#b07d3a",
  inputBarBg: "rgba(58,47,40,.55)", // 入力バーコンテナの背景
  inputBarBorder: "rgba(201,180,140,.22)", // 入力バーコンテナの枠線
  inputBarTopBorder: "rgba(201,180,140,.12)",
  inputPlaceholder: "#8e8470",
  sendInk: "#241a0e",
  // --- Claude Design 案A「燈」への完全踏襲（2026-07-14）で追加 ---
  avatarRingMsg: "rgba(201,180,140,.5)", // メッセージ左の38px丸アバター枠線
  innerMono: "#8c8270", // 心の声（inner）の文字色。ローズ/グロー廃止し design 通りの茶へ
  innerRule: "rgba(183,151,102,.35)", // 心の声の左罫線
  narration: "#b3a791", // ナレーション（narration）の文字色
  rememberBorder: "rgba(201,180,140,.4)", // 「覚えておく」破線チップの枠線
  rememberText: "#bda87f", // 「覚えておく」破線チップの文字色
  imageFrameBorder: "rgba(201,180,140,.28)", // 彼女の画像の枠線
  chipBorder: "rgba(201,180,140,.26)", // クイック返信チップ（通常）の枠線
  chipBg: "rgba(58,47,40,.5)", // クイック返信チップ（通常）の背景
  chipText: "#d6c6a6", // クイック返信チップ（通常）の文字色
  chipGoldBorder: "rgba(214,169,87,.5)", // クイック返信チップ（選択中・長さ）の枠線
  chipGoldBg: "rgba(214,169,87,.14)", // クイック返信チップ（選択中・長さ）の背景
  chipGoldBorderStrong: "rgba(214,169,87,.55)",
  chipGoldBgStrong: "rgba(214,169,87,.2)",
  chipTextStrong: "#f0c879",
  lampGlow: "rgba(214,160,84,.30)", // トーク画面上部のランプの滲み。design 仕様値
} as const;

export type OU2Key = keyof typeof OU2;
