import { and, desc, eq } from "drizzle-orm";

import { promptVariantTable } from "../schema/prompt-variant";

import { PROMPT_VARIANT_DEFAULT_BODY, type PromptVariantSlot } from "./prompt-variant-defaults";

import type { ScenePhase } from "./scene-phase";
import type { drizzle } from "drizzle-orm/d1";

type DatabaseClient = ReturnType<typeof drizzle>;

export interface ChampionVariant {
  id: string | null;
  body: string;
}

interface CachedChampionRow {
  id: string;
  body: string;
  phaseScope: string;
}

interface CacheEntry {
  value: CachedChampionRow | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const championRowCache = new Map<PromptVariantSlot, CacheEntry>();

export function __resetPromptVariantCacheForTests(): void {
  championRowCache.clear();
}

const fallback = (slot: PromptVariantSlot): ChampionVariant => ({
  id: null,
  body: PROMPT_VARIANT_DEFAULT_BODY[slot],
});

// candidate行のphase_scope("erotic,climax"等のCSV)に現在phaseが含まれるか。
// functions/api/[[route]].ts側にも同一ロジックがあったが、片方だけ修正されて
// 挙動がずれるのを防ぐためここへ一本化してexportする(実PR#803レビューで発見)。
export const phaseScopeIncludesPhase = (phaseScope: string, phase: ScenePhase): boolean =>
  phaseScope
    .split(",")
    .map((p) => p.trim())
    .includes(phase);

// isolate内メモリキャッシュ(短TTL) + D1 miss/エラー時は即ハードコード既定文面へ fallback する。
// champion body は滅多に変わらないため、リクエスト毎の D1 読取は避ける。
//
// キャッシュはslot単位のchampion行そのものを保持し、phaseとの適合判定は呼び出しの都度行う —
// phase単位でキャッシュを分けると同じ行を何度もD1から引き直すことになり非効率なため。
// championのphase_scopeが要求phaseを含まない場合は既定文面へfallbackする。理由:
// 一意インデックス(prompt_variant_slot_champion_unique_idx)によりslotのchampionは常に1行だけなので、
// phase_scopeがclimax限定のcandidateが昇格すると、そのslotの唯一のchampionがclimax限定になる。
// ここでphase判定を省くと、intimate/erotic/afterglowにもclimax限定文面が漏れて出てしまう。
export async function getChampionVariant(
  database: DatabaseClient,
  slot: PromptVariantSlot,
  phase: ScenePhase,
): Promise<ChampionVariant> {
  const cached = championRowCache.get(slot);
  const now = Date.now();
  let row: CachedChampionRow | null;
  if (cached && cached.expiresAt > now) {
    row = cached.value;
  } else {
    try {
      const rows = await database
        .select({
          id: promptVariantTable.id,
          body: promptVariantTable.body,
          phaseScope: promptVariantTable.phaseScope,
        })
        .from(promptVariantTable)
        .where(and(eq(promptVariantTable.slot, slot), eq(promptVariantTable.status, "champion")))
        .orderBy(desc(promptVariantTable.version))
        .limit(1);
      row = rows[0] ?? null;
    } catch {
      row = null;
    }
    championRowCache.set(slot, { value: row, expiresAt: now + CACHE_TTL_MS });
  }

  if (!row || !phaseScopeIncludesPhase(row.phaseScope, phase)) return fallback(slot);
  return { id: row.id, body: row.body };
}
