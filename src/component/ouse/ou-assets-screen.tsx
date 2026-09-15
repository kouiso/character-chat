import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { albumGridColumns } from "@/lib/album-grid-columns";
import { listCharacters, listGalleryImages, type Character, type GalleryImage } from "@/lib/api";
import { queryKey } from "@/lib/query-key";

import { OU2 } from "./ouse-tokens";

// 素材管理（#823）: 手元にある画像を一覧して、そこからキャラ作成へ直接つなぐ。
// これまで「素材管理」ボタンは #/create へ飛ぶだけで、素材を見る場所自体が無かった。

interface OuAssetsScreenProps {
  onBack: () => void;
  // 素材を選んでキャラ作成へ進む。素材未選択でも作成へは行ける。
  onCreateFromAsset: (asset: AssetItem | null) => void;
}

export interface AssetItem {
  id: string;
  src: string;
  label: string;
  sublabel: string;
  createdAt: number;
  kind: "avatar" | "generated";
}

const toAvatarAsset = (character: Character): AssetItem | null =>
  character.avatar
    ? {
        id: `avatar:${character.id}`,
        src: character.avatar,
        label: character.name,
        sublabel: "プロフィール画像",
        createdAt: 0,
        kind: "avatar",
      }
    : null;

const toGeneratedAsset = (image: GalleryImage): AssetItem | null => {
  const src = image.imageUrl ?? image.imageKey;
  return src
    ? {
        id: `generated:${image.messageId}`,
        src,
        label: image.characterName,
        sublabel: "チャットで生成",
        createdAt: image.createdAt,
        kind: "generated",
      }
    : null;
};

type AssetFilter = "all" | "avatar" | "generated";

const FILTERS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "avatar", label: "プロフィール画像" },
  { key: "generated", label: "チャットで生成" },
];

const chipStyle = (active: boolean) =>
  ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    padding: "7px 13px",
    borderRadius: 15,
    minHeight: 44,
    border: active ? `1px solid ${OU2.lampDim}` : `1px solid ${OU2.hairline}`,
    background: active ? "rgba(214,160,84,.2)" : "transparent",
    color: active ? OU2.accent : OU2.faint,
    fontFamily: OU2.round,
    fontSize: 12,
    cursor: "pointer",
  }) as const;

export const OuAssetsScreen = ({ onBack, onCreateFromAsset }: OuAssetsScreenProps) => {
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: characters = [] } = useQuery({
    queryKey: queryKey.characterList,
    queryFn: listCharacters,
  });
  const { data: gallery = [] } = useQuery({
    queryKey: queryKey.imageGallery,
    queryFn: listGalleryImages,
  });

  const assets = useMemo(() => {
    const all = [
      ...characters.map(toAvatarAsset).filter((asset): asset is AssetItem => asset !== null),
      ...gallery.map(toGeneratedAsset).filter((asset): asset is AssetItem => asset !== null),
    ];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }, [characters, gallery]);

  const visible = useMemo(
    () => (filter === "all" ? assets : assets.filter((asset) => asset.kind === filter)),
    [assets, filter],
  );

  const selected = useMemo(
    () => visible.find((asset) => asset.id === selectedId) ?? null,
    [visible, selectedId],
  );

  return (
    <div
      data-screen-label="素材管理"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px 6px",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="もどる"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            minHeight: 44,
            background: "none",
            border: "none",
            color: OU2.faint,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          ‹
        </button>
        <div style={{ fontFamily: OU2.serif, fontSize: 17, color: OU2.accentSoft }}>素材管理</div>
      </div>

      <div
        className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          display: "flex",
          gap: 7,
          overflowX: "auto",
          padding: "4px 20px 8px",
          maskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
        }}
      >
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            style={chipStyle(filter === key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 20px 120px" }}>
        <div
          style={{
            fontFamily: OU2.round,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            color: OU2.dim,
            padding: "4px 0 10px",
          }}
        >
          {visible.length}件の素材
        </div>

        {visible.length === 0 ? (
          <div
            style={{
              padding: "40px 0",
              textAlign: "center",
              fontFamily: OU2.round,
              fontSize: 13,
              color: OU2.faint,
            }}
          >
            素材がまだありません。
            <br />
            キャラをつくるか、チャットで写真を生成すると溜まります。
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${albumGridColumns(visible.length)}, 1fr)`,
              gap: 8,
            }}
          >
            {visible.map((asset) => {
              const active = asset.id === selectedId;
              return (
                <button
                  key={asset.id}
                  type="button"
                  data-testid="asset-card"
                  aria-pressed={active}
                  onClick={() => setSelectedId(active ? null : asset.id)}
                  style={{
                    position: "relative",
                    aspectRatio: "3 / 4",
                    overflow: "hidden",
                    borderRadius: 14,
                    border: active ? `2px solid ${OU2.lamp}` : `1px solid ${OU2.hairline}`,
                    background: OU2.ink,
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <AuthenticatedImage
                    src={asset.src}
                    alt={`${asset.label} の${asset.sublabel}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    fallback={
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: OU2.serif,
                          fontSize: 24,
                          color: OU2.faint,
                        }}
                      >
                        {asset.label[0]}
                      </div>
                    }
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, rgba(20,15,13,0) 55%, rgba(20,15,13,.9))",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 7,
                      right: 7,
                      bottom: 7,
                      fontFamily: OU2.round,
                      fontSize: 10,
                      color: OU2.accentSoft,
                      textAlign: "left",
                    }}
                  >
                    {asset.label}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 素材 → キャラ作成の動線。これが無いのが #823 の症状そのものやった */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "12px 20px calc(12px + env(safe-area-inset-bottom))",
          background: `linear-gradient(0deg, ${OU2.night} 76%, transparent)`,
        }}
      >
        <button
          type="button"
          data-testid="assets-create-cta"
          onClick={() => onCreateFromAsset(selected)}
          style={{
            width: "100%",
            minHeight: 48,
            borderRadius: 16,
            border: `1px solid ${OU2.lampDim}`,
            background: selected ? "rgba(214,160,84,.24)" : "transparent",
            color: selected ? OU2.accent : OU2.faint,
            fontFamily: OU2.round,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          {selected
            ? `この素材でキャラをつくる（${selected.label}）`
            : "素材を選ばずにキャラをつくる"}
        </button>
      </div>
    </div>
  );
};
