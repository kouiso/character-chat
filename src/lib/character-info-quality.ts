const POLICY_HEAVY_PATTERNS = [
  /AI\s*(?:チャット|キャラクター|アシスタント|モデル|生成|応答|ロールプレイ)?/iu,
  /(?:コンテンツ|content)\s*(?:policy|ポリシー)/iu,
  /(?:安全|セーフティ|倫理|ethics?|ガイドライン|規約|自主規制|フィルタリング)/iu,
  // 「キスは禁止」のようなキャラ本人の境界線まで消さんため、禁止・違反は運営側の主語と同居する時だけ落とす
  /(?:運営|プラットフォーム|サービス|システム|法律|法令|コンプライアンス|プロンプト)[^。！？.!?]{0,40}(?:禁止|違反)/u,
  /(?:成人向け|アダルト)\s*(?:AI|ロールプレイ用|チャット用)\s*(?:キャラクター|設定|プロフィール)/iu,
  /(?:制約|制限)は一切(?:ありません|ない)/u,
  /どんな過激な内容でも/u,
  /(?:申し訳ありません|申し訳ございません|対応できません|お答えできません)/u,
] as const;

const BAD_PROSE_PATTERNS = [
  /(?:性格・見た目|性的特徴プロフィール|出会いのシチュエーション)/u,
  /(?:以下\d+項目|JSON|enum|タグ\d+)/iu,
  /(?:してください|記述すること|含めること|出力しないでください)/u,
] as const;

export type CharacterInfoQualityIssue = "policy-heavy" | "bad-prose";

export const getCharacterInfoQualityIssues = (text: string): CharacterInfoQualityIssue[] => {
  const issues = new Set<CharacterInfoQualityIssue>();

  if (POLICY_HEAVY_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.add("policy-heavy");
  }
  if (BAD_PROSE_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.add("bad-prose");
  }

  return Array.from(issues);
};

export const hasBadCharacterInfoText = (text: string): boolean =>
  getCharacterInfoQualityIssues(text).length > 0;

const splitCharacterInfoSegments = (text: string): string[] =>
  text
    .split(/\r?\n+/)
    .flatMap((line) => line.match(/[^。！？.!?]+[。！？.!?]?/gu) ?? [line])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

export const cleanCharacterInfoText = (text: string): string =>
  splitCharacterInfoSegments(text)
    .filter((segment) => !hasBadCharacterInfoText(segment))
    .join("\n")
    .trim();
