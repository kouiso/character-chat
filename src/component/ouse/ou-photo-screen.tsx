import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { albumGridColumns } from "@/lib/album-grid-columns";
import { listGalleryImages, type GalleryImage } from "@/lib/api";
import { shouldAuthenticate, useAuthenticatedImageUrl } from "@/lib/authenticated-image";
import { resolveAvatarSrc } from "@/lib/avatar-url";
import { queryKey } from "@/lib/query-key";
import type { ChatMessage } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

import { OuPhotoOverlay, type OuPhotoOverlayItem } from "./ou-media-overlay";
import { OU2 } from "./ouse-tokens";

interface OuPhotoScreenProps {
  messages: ChatMessage[];
  mode?: "conversation" | "gallery";
  onBack?: () => void;
  characterName?: string;
  // 素材管理画面への遷移。gallery モードでのみ使う（#823）
  onAssets?: () => void;
}

// 設計 D-frame 共通の room 背景（3-stop）。中間層 nightMid を 54% に挟む。
const ROOM_BACKGROUND = `radial-gradient(120% 60% at 50% -6%, ${OU2.ink} 0%, ${OU2.nightMid} 54%, ${OU2.night} 100%)`;

// gallery(messageId)/conversation(id) でキーが異なるため、呼び出し側で絞り込んだ items から探す。
const resolveSelectedPhoto = (
  items: OuPhotoOverlayItem[],
  selectedId: string | null,
): OuPhotoOverlayItem | null =>
  selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;

const shimmerStyle = {
  backgroundImage:
    "linear-gradient(100deg, rgba(214,160,84,.08) 40%, rgba(214,160,84,.16) 50%, rgba(214,160,84,.08) 60%)",
  backgroundSize: "400px 100%",
  animation: "ouAlbumShimmer 1.6s linear infinite",
} as const;

const AlbumTileSkeleton = ({ style }: { style?: React.CSSProperties }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: OU2.ink,
      ...shimmerStyle,
      ...style,
    }}
  >
    <span style={{ fontSize: 10.5, fontFamily: OU2.round, color: OU2.faint }}>現像中…</span>
  </div>
);

const ImageGrid = ({
  items,
  selectedId,
  onSelect,
}: {
  items: OuPhotoOverlayItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: 4,
      padding: "4px 0",
    }}
  >
    {items.map(({ id, src, characterName }) => (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        aria-label={characterName ? `${characterName}の写真` : "写真"}
        style={{
          position: "relative",
          aspectRatio: "1",
          overflow: "hidden",
          borderRadius: 6,
          border: selectedId === id ? `2px solid ${OU2.lamp}` : "2px solid transparent",
          padding: 0,
          cursor: "zoom-in",
          background: OU2.ink,
        }}
      >
        {src ? (
          <AuthenticatedImage
            src={src}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loadingFallback={<AlbumTileSkeleton style={{ width: "100%", height: "100%" }} />}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: OU2.faint,
              fontSize: 11,
              fontFamily: OU2.round,
            }}
          >
            生成中…
          </div>
        )}
      </button>
    ))}
  </div>
);

const EmptyState = ({ label }: { label: string }) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: OU2.faint,
      fontFamily: OU2.round,
      fontSize: 13,
      letterSpacing: "0.06em",
    }}
  >
    {label}
  </div>
);

const ConversationPhotoScreen = ({
  messages,
  characterName,
}: {
  messages: ChatMessage[];
  characterName: string;
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const images = messages.filter((m) => m.role === "assistant" && (m.imageUrl || m.imageKey));
  if (images.length === 0) return <EmptyState label="写真はまだありません" />;

  const items = images.map((m) => ({
    id: m.id,
    src: m.imageUrl ?? undefined,
    characterName,
  }));
  const photo = resolveSelectedPhoto(items, selected);

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <OuPhotoOverlay
        photo={photo}
        photos={items}
        onClose={() => setSelected(null)}
        onPick={setSelected}
      />
      <ImageGrid items={items} selectedId={selected} onSelect={setSelected} />
    </div>
  );
};

const formatPhotoDate = (createdAt: number) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit" }).format(date);
};

const getGallerySource = (image: GalleryImage) => image.imageUrl ?? undefined;

type GalleryFilter = { kind: "all" } | { kind: "char"; id: string };

const dateKey = (createdAt: number) => {
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const isToday = (createdAt: number) => dateKey(createdAt) === dateKey(Date.now());

// 日付ごとの見出し。今日は「今夜」、それ以外は「M月D日」。単一キャラのまとまりのみ相手名を添える。
const sectionLabel = (images: GalleryImage[]) => {
  const first = images[0];
  if (isToday(first.createdAt)) return "今夜";
  const d = new Date(first.createdAt);
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  const single = images.every((img) => img.characterName === first.characterName);
  return single ? `${base} ・ ${first.characterName}` : base;
};

// API は createdAt 降順で返す前提。出現順を保ったまま同一日で束ねる。
const groupByDate = (images: GalleryImage[]) => {
  const map = new Map<string, GalleryImage[]>();
  for (const img of images) {
    const key = dateKey(img.createdAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(img);
    else map.set(key, [img]);
  }
  return [...map.values()];
};

const PhotoHeader = ({ onAssets }: { onAssets?: () => void }) => (
  <div
    style={{
      position: "absolute",
      top: 52,
      left: 24,
      right: 24,
      zIndex: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    }}
  >
    <span style={{ fontFamily: OU2.serif, fontSize: 23, fontWeight: 600, color: OU2.text }}>
      アルバム
    </span>
    {/* 素材管理への入口。従来は素材を見る場所が無く、キャラ作成への動線も無かった(#823) */}
    {onAssets && (
      <button
        type="button"
        data-testid="album-assets-entry"
        onClick={onAssets}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 44,
          padding: "0 13px",
          borderRadius: 15,
          border: `1px solid ${OU2.hairline}`,
          background: "transparent",
          color: OU2.faint,
          fontFamily: OU2.round,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        素材管理
      </button>
    )}
  </div>
);

const FilterPills = ({
  characters,
  filter,
  onSelect,
}: {
  characters: { id: string; name: string }[];
  filter: GalleryFilter;
  onSelect: (filter: GalleryFilter) => void;
}) => {
  const pill = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: "0 0 auto",
        padding: "7px 13px",
        borderRadius: 15,
        fontSize: 12,
        fontFamily: OU2.round,
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "center",
        boxSizing: "border-box",
        maxWidth: 220,
        minHeight: 44,
        minWidth: 44,
        background: active ? "rgba(214,160,84,.2)" : "transparent",
        border: `1px solid ${active ? OU2.lampDim : OU2.hairline}`,
        color: active ? OU2.accent : OU2.faint,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        position: "absolute",
        top: 96,
        left: 24,
        right: 0,
        zIndex: 7,
        display: "flex",
        gap: 7,
        overflowX: "auto",
        paddingRight: 24,
        maskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
        WebkitMaskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
      }}
    >
      {pill(filter.kind === "all", "すべて", () => onSelect({ kind: "all" }))}
      {characters.map((c) =>
        pill(filter.kind === "char" && filter.id === c.id, c.name, () =>
          onSelect({ kind: "char", id: c.id }),
        ),
      )}
      <div aria-hidden style={{ flexShrink: 0, width: 20 }} />
    </div>
  );
};

const AlbumTileMedia = ({ url, veil }: { url: string | null; veil: boolean }) => {
  const style = {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    filter: veil ? "blur(14px)" : undefined,
    transform: veil ? "scale(1.08)" : undefined,
  };
  return <img src={url || undefined} alt="" style={style} />;
};

const AlbumTileImage = ({
  image,
  veil,
  onOpen,
  onRetry,
}: {
  image: GalleryImage;
  veil: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) => {
  const src = getGallerySource(image);
  // 配信失敗（認証フェッチの 401 等）を検知して破線＋再試行導線を出すために解決結果を購読する。
  // <AuthenticatedImage> を別途使うと内部で同じ URL をもう一度解決し object URL を二重生成するため、
  // ここで得た url をそのまま <img> に渡して一度の解決で完結させる。
  const resolved = resolveAvatarSrc(src);
  const { url, failed } = useAuthenticatedImageUrl(resolved ?? "");
  const isAuthLoading = Boolean(resolved && shouldAuthenticate(resolved) && !url && !failed);

  const frame = {
    position: "relative" as const,
    borderRadius: 13,
    overflow: "hidden",
    aspectRatio: "3 / 4",
    background: OU2.ink,
  };

  // 未配信・認証 blob 取得中はシマーで現像中を表現する。生成失敗との区別はデータに無いため未到着は一律「現像中」。
  if (!src || isAuthLoading) {
    return <AlbumTileSkeleton style={{ ...frame, position: "relative" }} />;
  }

  // 認証フェッチ失敗を配信失敗として扱い、破線＋再試行導線を出す。
  if (failed) {
    return (
      <div
        style={{
          ...frame,
          border: `1px dashed ${OU2.warnBorder}`,
          background: OU2.warnBg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14, color: OU2.warn }}>◍</span>
        <span style={{ fontSize: 10, color: OU2.warnText, textAlign: "center", lineHeight: 1.5 }}>
          届きません
          <br />
          でした
        </span>
        <button
          type="button"
          onClick={onRetry}
          style={{
            fontSize: 11,
            color: OU2.lamp,
            background: "transparent",
            border: `1px solid ${OU2.lampDim}`,
            borderRadius: 999,
            cursor: "pointer",
            padding: "10px 14px",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          ↻ 再試行
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${formatPhotoDate(image.createdAt)}の${image.characterName}の写真を開く`}
      style={{ ...frame, border: "none", padding: 0, cursor: "zoom-in" }}
    >
      <AlbumTileMedia url={url} veil={veil} />
    </button>
  );
};

const AlbumTile = ({
  image,
  veil,
  onOpen,
}: {
  image: GalleryImage;
  veil: boolean;
  onOpen: () => void;
}) => {
  // 再試行時は AuthenticatedImage の内部フェッチをやり直させたいので、key を変えて再マウントする
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <AlbumTileImage
      key={reloadKey}
      image={image}
      veil={veil}
      onOpen={onOpen}
      onRetry={() => setReloadKey((n) => n + 1)}
    />
  );
};

const AlbumBody = ({
  images,
  veil,
  emptyMessage,
  onOpen,
}: {
  images: GalleryImage[];
  veil: boolean;
  emptyMessage: string;
  onOpen: (image: GalleryImage) => void;
}) => {
  if (images.length === 0) {
    return (
      <div
        style={{
          position: "absolute",
          inset: "144px 22px 88px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: OU2.faint,
          fontFamily: OU2.round,
          fontSize: 11.5,
          letterSpacing: ".08em",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 144,
        left: 20,
        right: 20,
        bottom: 88,
        overflowY: "auto",
        scrollbarWidth: "none",
      }}
    >
      {groupByDate(images).map((section) => (
        <div key={dateKey(section[0].createdAt)}>
          <div
            style={{
              fontSize: 10.5,
              fontFamily: OU2.round,
              letterSpacing: ".18em",
              color: OU2.faint,
              margin: "4px 4px 9px",
            }}
          >
            {sectionLabel(section)}
          </div>
          <div
            style={{
              display: "grid",
              // 同一セクション内のタイルを空セル無く敷き詰める（1〜3枚は枚数に合わせ、それ以上は最終行の空きが最小になる列数）
              gridTemplateColumns: `repeat(${albumGridColumns(section.length)}, 1fr)`,
              gap: 8,
              marginBottom: 16,
            }}
          >
            {section.map((image) => (
              <AlbumTile
                key={image.messageId}
                image={image}
                veil={veil}
                onOpen={() => onOpen(image)}
              />
            ))}
          </div>
        </div>
      ))}
      <div style={{ textAlign: "center", fontSize: 11, color: OU2.dim, padding: "4px 0" }}>
        タップで拡大 ・ 長押しで保存 / その会話へ飛ぶ
      </div>
    </div>
  );
};

const GalleryPhotoScreen = ({ onAssets }: { onAssets?: () => void }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<GalleryFilter>({ kind: "all" });
  const nsfwBlur = useSettingsStore((s) => s.nsfwBlur);

  const {
    data: allImages = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKey.imageGallery,
    queryFn: listGalleryImages,
  });

  const characters = useMemo(() => {
    const seen = new Set<string>();
    return allImages
      .filter((img) => {
        if (seen.has(img.characterId)) return false;
        seen.add(img.characterId);
        return true;
      })
      .map((img) => ({ id: img.characterId, name: img.characterName }));
  }, [allImages]);

  const filtered = allImages.filter((img) => {
    if (filter.kind === "all") return true;
    return img.characterId === filter.id;
  });

  const emptyMessage =
    allImages.length === 0 ? "まだ、なにもとどいていない" : "この子の写真はまだありません";
  const items = filtered.map((img) => ({
    id: img.messageId,
    src: img.imageUrl ?? undefined,
    characterId: img.characterId,
    characterName: img.characterName,
    characterAvatar: img.characterAvatar,
    createdAt: img.createdAt,
  }));
  const photo = resolveSelectedPhoto(items, selected);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: "100%" }} data-screen-label="アルバム">
      {/* keyframes はインライン style で表現できないため要素として注入する */}
      <style>
        {
          "@keyframes ouAlbumShimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}"
        }
      </style>
      <div style={{ position: "absolute", inset: 0, background: ROOM_BACKGROUND }} />
      <OuPhotoOverlay
        photo={photo}
        photos={items}
        onClose={() => setSelected(null)}
        onPick={setSelected}
      />
      <PhotoHeader onAssets={onAssets} />
      <FilterPills characters={characters} filter={filter} onSelect={setFilter} />
      {isLoading || isError ? (
        <div
          style={{
            position: "absolute",
            inset: "144px 22px 88px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: OU2.faint,
            fontFamily: OU2.round,
            fontSize: 11.5,
            letterSpacing: ".08em",
          }}
        >
          {isError ? "アルバムを読み込めませんでした" : "読み込み中…"}
        </div>
      ) : (
        <AlbumBody
          images={filtered}
          veil={nsfwBlur}
          emptyMessage={emptyMessage}
          onOpen={(image) => setSelected(image.messageId)}
        />
      )}
    </div>
  );
};

// onBack は props 契約として残すが、設計 D-2 に戻るボタンが無いためこの画面では使わない。
export const OuPhotoScreen = ({
  messages,
  mode = "conversation",
  characterName,
  onAssets,
}: OuPhotoScreenProps) => {
  if (mode === "gallery") return <GalleryPhotoScreen onAssets={onAssets} />;
  return <ConversationPhotoScreen messages={messages} characterName={characterName ?? ""} />;
};
