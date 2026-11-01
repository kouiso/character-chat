// v2 の CLI 経路が本番へ触れんよう --remote を拒否する安全弁。
// D1 id は設計上 v2 も本番 `adult-ai-db` を正本として束ねる（新旧同居期間に同じ DB を読むため）。
// ローカルの persist ファイルは database_id ごとに分かれるので、ここでも同じ実 id を使う。
// 実 id を使うので、--remote を付けて叩くと本番に届く。「ローカルに留める」責務は createPlatform の
// remote 拒否と、この検査（package.json の tsx 入口がすべて最初に呼ぶ。assert-local.test.ts で確認）が担う。
export const V1_PROD_D1_ID = "b617800c-cf4c-4122-adbb-ce872a258da6";

export function assertLocalOnly(argv: readonly string[]): void {
  if (argv.includes("--remote")) {
    throw new Error("v2 D1 is local-only");
  }
}
