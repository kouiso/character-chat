// 生成課金（RIT-188）。生成ごとに台帳へ spend、失敗した生成には同額の refund を記録する。
// 突合は ref_type="generation" / ref_id=<generation id> で、返却の有無は生成記録→台帳で辿れる。
// 購入導線（RIT-192）が来るまでは初回利用時にシード付与で台帳を回す。
import { grantCurrency, refundCurrency, spendCurrency, type CurrencyKind } from "./currency";

// 生成種別ごとの消費量（最小単位）。コマはコマごとに image として計上する。
export const GENERATION_COST = { image: 10, video: 50 } as const;
export type BillableGenerationKind = keyof typeof GENERATION_COST;

// RIT-192 の購入導線ができるまでのブートストラップ。冪等キー固定で一度だけ入る。
export const INITIAL_GRANT = 10_000;

const bootstrapKey = (userId: string): string => `bootstrap:${userId}`;
const chargeKey = (generationId: string): string => `charge:${generationId}`;
const refundKey = (generationId: string): string => `refund:${generationId}`;

export const ensureSeedBalance = (db: D1Database, userId: string): Promise<unknown> =>
  grantCurrency(db, {
    userId,
    amount: INITIAL_GRANT,
    reason: "初期付与",
    idempotencyKey: bootstrapKey(userId),
  });

// 生成開始時の課金。残高不足は CurrencyError(409) が上がり、呼び出し側で 409 応答へ写す。
// 成功すれば charge:{generationId} の spend 行が残り、以後の失敗は refund で返す。
// 本人専用運用の V2_UNLIMITED=1 では課金そのものを行わない。
export const chargeGeneration = async (
  db: D1Database,
  input: { userId: string; generationId: string; kind: BillableGenerationKind },
  env?: { V2_UNLIMITED?: string },
): Promise<void> => {
  if (env?.V2_UNLIMITED === "1") return;
  await ensureSeedBalance(db, input.userId);
  const label = input.kind === "video" ? "動画生成" : "画像生成";
  await spendCurrency(db, {
    userId: input.userId,
    amount: GENERATION_COST[input.kind],
    reason: label,
    refType: "generation",
    refId: input.generationId,
    idempotencyKey: chargeKey(input.generationId),
  });
};

// 生成失敗時の返却。refund:{generationId} 固定キーで、リトライや重複呼出しでも二重返却しない。
// charge されていない generationId に対しても呼べるが、その場合は呼び出し側の責務
// （charge 後の失敗経路からだけ呼ぶ）。
export const refundGeneration = async (
  db: D1Database,
  input: { userId: string; generationId: string; kind: BillableGenerationKind },
): Promise<void> => {
  await refundCurrency(db, {
    userId: input.userId,
    amount: GENERATION_COST[input.kind],
    reason: "生成失敗の返却",
    refType: "generation",
    refId: input.generationId,
    idempotencyKey: refundKey(input.generationId),
  });
};

// 返金の記録に失敗しても生成結果（失敗）の返却を妨げない。失敗行は生成記録に残るので
// 台帳側だけ後から突合・再計上できる。
export const refundGenerationBestEffort = async (
  db: D1Database,
  input: { userId: string; generationId: string; kind: BillableGenerationKind },
): Promise<void> => {
  try {
    await refundGeneration(db, input);
  } catch {
    // 握る。台帳は生成記録の failed 行と冪等キーで後から整合させられる。
  }
};

export const GENERATION_REF_TYPE = "generation" as const;
export type { CurrencyKind };
