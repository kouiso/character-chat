-- 同一slotに複数championが並存するバグを検知/防止する部分ユニークインデックス。
-- 0047は適用済み・push済みのため、このindexは新規migrationとして追加する。
CREATE UNIQUE INDEX prompt_variant_slot_champion_unique_idx ON prompt_variant(slot) WHERE status = 'champion';
