// v1 の本番 D1 id を v2 の wrangler 設定や CLI 引数へ誤って束縛/使用せんための安全弁。
export const V1_PROD_D1_ID = "b617800c-cf4c-4122-adbb-ce872a258da6";
export const V2_LOCAL_D1_ID = "c0ffee00-0000-4000-8000-000000000001";

export function assertLocalOnly(argv: readonly string[]): void {
  if (argv.includes("--remote")) {
    throw new Error("v2 D1 is local-only");
  }
}

export function assertNotProdD1(databaseId: string): void {
  if (databaseId === V1_PROD_D1_ID) {
    throw new Error("v2 must not bind the production D1 id");
  }
}
