// workers-types が追いついとらん実行時 export の型だけを補う。
// cloudflare:workers の waitUntil は実行時には存在する（v5 types は env/exports のみ宣言済み）。
declare module "cloudflare:workers" {
  export const waitUntil: (promise: Promise<unknown>) => void;
}
