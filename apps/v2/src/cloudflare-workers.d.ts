// workers-types が追いついとらん実行時 export の型だけを補う。
// cloudflare:workers の env/ctx/exports は実行時には存在する（v5 types は env のみ宣言済み）。
declare module "cloudflare:workers" {
  export const ctx: ExecutionContext;
}
