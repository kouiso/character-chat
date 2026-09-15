import { useMemo, useRef, type CSSProperties, type RefObject } from "react";

import { Dialog } from "@base-ui/react/dialog";
import { Download, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { apiFetch } from "@/lib/api";
import { saveBlobAsImage } from "@/lib/download-image";
import { useSettingsStore } from "@/store/settings-store";

import { OU2 } from "./ouse-tokens";

export interface OuPhotoOverlayItem {
  id: string;
  src: string | null | undefined;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  createdAt?: number | null;
}

// 設計 2e: 上下の暗幕グラデ。上部で操作系、下部でタイトル/再生系を読ませる。
const TOP_SCRIM = OU2.viewerScrimTop;
const BOTTOM_SCRIM = OU2.viewerScrimBottom;

const formatTimestamp = (createdAt?: number | null): string => {
  if (!createdAt) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
};

// 認証付きメディア取得 → 端末保存。/api 配下は JWT が要るため apiFetch を通す。
const saveMedia = async (src: string, filename: string): Promise<void> => {
  if (!src) return;
  try {
    const response = src.startsWith("/api/") ? await apiFetch(src) : await fetch(src);
    if (!response.ok) {
      toast.error("保存できませんでした");
      return;
    }
    await saveBlobAsImage(await response.blob(), filename);
  } catch {
    toast.error("保存できませんでした");
  }
};

// 設計に⋯メニューの中身定義は無いため最小構成（共有のみ）で実装。
// Web Share API 非対応環境はURLコピーにフォールバック。
const shareMedia = async (src: string, title: string): Promise<void> => {
  const url = src.startsWith("/") ? `${window.location.origin}${src}` : src;
  try {
    if (navigator.share) {
      await navigator.share({ url, title });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success("リンクをコピーしました");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    toast.error("共有できませんでした");
  }
};

// 設計 2e: 半透明のガラス円形ボタン（✕ / ↓）
const glassCircle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 999,
  background: OU2.viewerGlass,
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

const Scrims = () => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 130,
        background: TOP_SCRIM,
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 210,
        background: BOTTOM_SCRIM,
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  </>
);

const TopControls = ({
  onClose,
  closeLabel,
  closeRef,
  onSave,
  onShare,
}: {
  onClose: () => void;
  closeLabel: string;
  // Dialog の初期フォーカス先。開いた直後に何を読み上げるかがこれで決まる。
  closeRef: RefObject<HTMLButtonElement | null>;
  onSave: () => void;
  onShare?: () => void;
}) => (
  <div
    style={{
      position: "absolute",
      top: "calc(env(safe-area-inset-top) + 14px)",
      left: 20,
      right: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      zIndex: 6,
    }}
  >
    <button
      ref={closeRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      aria-label={closeLabel}
      style={{ ...glassCircle, color: OU2.text }}
    >
      <X size={16} />
    </button>
    <div style={{ display: "flex", gap: 10 }}>
      {onShare ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onShare();
          }}
          aria-label="共有"
          style={{ ...glassCircle, color: OU2.goldBright }}
        >
          <MoreHorizontal size={16} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void onSave();
        }}
        aria-label="保存"
        style={{ ...glassCircle, color: OU2.goldBright }}
      >
        <Download size={15} />
      </button>
    </div>
  </div>
);

// 設計 2e: 名前は上部ではなく下部に配置。sub は撮影時刻・尺などを薄く添える。
const BottomTitle = ({ title, sub }: { title: string; sub?: string }) => (
  <div style={{ minWidth: 0 }}>
    <div
      style={{
        fontFamily: OU2.serif,
        fontSize: 14,
        color: OU2.text,
        textShadow: OU2.readShadow,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {title}
    </div>
    {sub ? (
      <div
        style={{
          fontFamily: OU2.serif,
          fontSize: 10.5,
          fontStyle: "italic",
          color: OU2.dim,
          marginTop: 3,
          textShadow: OU2.readShadow,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {sub}
      </div>
    ) : null}
  </div>
);

const VeilCaption = () => (
  <div
    style={{
      position: "absolute",
      top: "46%",
      left: 0,
      right: 0,
      textAlign: "center",
      zIndex: 5,
      pointerEvents: "none",
    }}
  >
    <span style={{ fontFamily: OU2.round, fontSize: 11, letterSpacing: ".24em", color: OU2.dim }}>
      紗がかかっている
    </span>
    <div
      style={{
        fontFamily: OU2.round,
        fontSize: 9,
        letterSpacing: ".1em",
        color: OU2.faint,
        marginTop: 6,
      }}
    >
      しつらえで、外せる
    </div>
  </div>
);

const mediaStyle = (veil: boolean): CSSProperties => ({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  filter: veil ? "blur(18px)" : "none",
  transform: veil ? "scale(1.04)" : "none",
  transition: "filter .24s ease, transform .24s ease",
});

type OpenPhoto = OuPhotoOverlayItem & { src: string };

const isOpenPhoto = (item: OuPhotoOverlayItem | null): item is OpenPhoto => Boolean(item?.src);

const PhotoOverlayBody = ({
  photo,
  photos,
  onClose,
  onPick,
  closeRef,
}: {
  photo: OpenPhoto;
  photos: OuPhotoOverlayItem[];
  onClose: () => void;
  onPick: (id: string) => void;
  closeRef: RefObject<HTMLButtonElement | null>;
}) => {
  const veil = useSettingsStore((state) => state.nsfwBlur);
  const strip = useMemo(() => {
    const sameCharacter = photos.filter(
      (item) => item.src && (!photo.characterId || item.characterId === photo.characterId),
    );
    // 4件ウィンドウを維持しつつ現在開いている写真は必ず含める。単純な slice(-4) だと
    // 直近4件の外から古い写真を開いた場合にストリップから消えハイライトが破綻するため。
    const activeIndex = sameCharacter.findIndex((item) => item.id === photo.id);
    if (activeIndex === -1) return sameCharacter.slice(-4);
    const windowSize = 4;
    const start = Math.min(
      Math.max(0, activeIndex - Math.floor(windowSize / 2)),
      Math.max(0, sameCharacter.length - windowSize),
    );
    return sameCharacter.slice(start, start + windowSize);
  }, [photo, photos]);

  const characterName = photo.characterName ?? "";

  return (
    <>
      <AuthenticatedImage src={photo.src} alt="" draggable={false} style={mediaStyle(veil)} />
      <button
        type="button"
        aria-label="写真の背景を閉じる"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          cursor: "zoom-out",
          zIndex: 1,
        }}
      />
      <Scrims />
      <TopControls
        onClose={onClose}
        closeLabel="写真を閉じる"
        closeRef={closeRef}
        onSave={() => {
          void saveMedia(photo.src, `${characterName}.png`);
        }}
        onShare={() => {
          void shareMedia(photo.src, characterName);
        }}
      />
      {/* 設計 2e: 前後の写真は本来スワイプ。onPick ナビゲーションを保つためストリップは残す。 */}
      {strip.length > 1 ? (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: 150,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 7,
          }}
        >
          {strip.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.id)}
              aria-label="写真を選ぶ"
              style={{
                width: 34,
                height: 46,
                padding: 0,
                border: "none",
                borderRadius: 8,
                overflow: "hidden",
                background: OU2.ink,
                cursor: "pointer",
                opacity: item.id === photo.id ? 1 : 0.6,
                boxShadow:
                  item.id === photo.id ? `0 0 0 1.5px ${OU2.lamp}` : `0 0 0 1px ${OU2.hairline}`,
              }}
            >
              {item.src ? (
                <AuthenticatedImage
                  src={item.src}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: veil ? "blur(18px)" : "none",
                    transform: veil ? "scale(1.04)" : "none",
                  }}
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {veil ? <VeilCaption /> : null}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "calc(env(safe-area-inset-bottom) + 30px)",
          padding: "0 24px",
          zIndex: 6,
        }}
      >
        <BottomTitle title={characterName} sub={formatTimestamp(photo.createdAt)} />
      </div>
    </>
  );
};

export const OuPhotoOverlay = ({
  photo,
  photos,
  onClose,
  onPick,
}: {
  photo: OuPhotoOverlayItem | null;
  photos: OuPhotoOverlayItem[];
  onClose: () => void;
  onPick: (id: string) => void;
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const activePhoto = isOpenPhoto(photo) ? photo : null;

  // 自前の fixed div では、開いた元のタイルへフォーカスが残ったまま aria-modal で
  // 背景ごと隠れ、Tab が見えん背景のボタンを巡り、閉じても body へ迷子になっとった。
  // Sheet と同じ base-ui Dialog に載せ替えて、初期フォーカス・トラップ・復帰・Escape を
  // プリミティブ側に任せる。Portal も body 直下へ出るので、呼び出し元(.ou-col, z-index:20)の
  // スタッキングコンテキストに沈む問題は今までどおり避けられる。
  return (
    <Dialog.Root
      open={activePhoto !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup
          data-screen-label="写真・全画面"
          aria-modal="true"
          aria-label="写真・全画面"
          initialFocus={closeRef}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: OU2.viewerBg }}
        >
          {activePhoto ? (
            <PhotoOverlayBody
              photo={activePhoto}
              photos={photos}
              onClose={onClose}
              onPick={onPick}
              closeRef={closeRef}
            />
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
