import { useEffect, useRef, useState } from "react";

import { listAvatarCandidates, type AvatarCandidate } from "../lib/avatar-album";
import {
  checkAvatarFile,
  chooseAvatarImage,
  uploadAvatarFile,
  AvatarRequestError,
} from "../lib/avatar-client";
import { avatarUrl } from "../lib/avatar-url";

const AvatarAlbumSheet = ({
  characterId,
  sending,
  onChoose,
}: {
  characterId: string;
  sending: boolean;
  onChoose: (item: AvatarCandidate) => Promise<void>;
}) => {
  const [album, setAlbum] = useState<"loading" | "failed" | AvatarCandidate[]>("loading");
  const [picked, setPicked] = useState<AvatarCandidate | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    listAvatarCandidates(characterId).then(
      (items) => alive && setAlbum(items),
      () => alive && setAlbum("failed"),
    );
    return () => {
      alive = false;
    };
  }, [characterId, attempt]);

  return (
    <div className="v2-avatar-picker-album" aria-label="アルバムから選ぶ">
      <h3>アルバムから選ぶ</h3>
      {album === "loading" && <p role="status">アルバムを読み込んでいます</p>}
      {album === "failed" && (
        <>
          <p role="alert">アルバムを読み込めませんでした。</p>
          <button
            type="button"
            onClick={() => {
              setAlbum("loading");
              setAttempt((value) => value + 1);
            }}
          >
            もう一度
          </button>
        </>
      )}
      {Array.isArray(album) && album.length === 0 && (
        <>
          <p>この子の画像は、まだありません。</p>
          <p className="v2-editor-note">トークで画像をもらうと、ここで選べます。</p>
        </>
      )}
      {Array.isArray(album) && album.length > 0 && (
        <>
          <p className="v2-editor-note">選んだ画像を、丸く切り抜いて顔にします。</p>
          <ul>
            {album.map((item) => (
              <li key={item.messageId}>
                <button
                  type="button"
                  aria-pressed={picked?.messageId === item.messageId}
                  aria-label="この画像を選ぶ"
                  onClick={() => setPicked(item)}
                >
                  <img src={item.imageUrl} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!picked || sending}
            onClick={() => picked && void onChoose(picked)}
          >
            これにする
          </button>
        </>
      )}
    </div>
  );
};

const AvatarMenu = ({
  sending,
  canAlbum,
  hasAvatar,
  onFile,
  onAlbum,
  onClear,
}: {
  sending: boolean;
  canAlbum: boolean;
  hasAvatar: boolean;
  onFile: (file: File | undefined) => void;
  onAlbum: () => void;
  onClear: () => void;
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="v2-avatar-picker-menu">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="顔にする画像のファイル"
        hidden
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button type="button" disabled={sending} onClick={() => fileInput.current?.click()}>
        自分の画像を使う
      </button>
      <button type="button" disabled={sending || !canAlbum} onClick={onAlbum}>
        アルバムから選ぶ
      </button>
      {!canAlbum && <p className="v2-editor-note">アルバムは、この子を保存したあとに選べます。</p>}
      {hasAvatar && (
        <button type="button" disabled={sending} onClick={onClear}>
          顔を外す
        </button>
      )}
    </div>
  );
};

// 板 CharacterEdit「顔を変える」。「描き直す」は別の作業単位なのでここには置かない。
export const CharacterAvatarPicker = ({
  characterId,
  savedAvatarRef,
  avatarRef,
  onChange,
}: {
  characterId?: string;
  // 保存済みの値。これと同じ間は配信の URL で、違う間は選んだ直後の見た目で出す。
  savedAvatarRef: string | null;
  avatarRef: string | null;
  onChange: (ref: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const showPreview = (url: string | null, revocable: boolean) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = revocable ? url : null;
    setPreview(url);
  };

  const current =
    avatarRef && avatarRef === savedAvatarRef && characterId
      ? avatarUrl(characterId, avatarRef)
      : preview;

  const apply = async (task: () => Promise<string>, shown: string, revocable: boolean) => {
    setSending(true);
    setError(null);
    try {
      onChange(await task());
      showPreview(shown, revocable);
      setAlbumOpen(false);
    } catch (cause) {
      if (revocable) URL.revokeObjectURL(shown);
      setError(cause instanceof AvatarRequestError ? cause.message : "顔を送れませんでした。");
    } finally {
      setSending(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reason = checkAvatarFile(file);
    if (reason) {
      setError(reason);
      return;
    }
    void apply(() => uploadAvatarFile(characterId, file), URL.createObjectURL(file), true);
  };

  return (
    <section className="v2-avatar-picker" aria-label="顔">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        顔を変える
      </button>
      {current && <img className="v2-avatar-picker-face" src={current} alt="いまの顔" />}
      {open && (
        <AvatarMenu
          sending={sending}
          canAlbum={Boolean(characterId)}
          hasAvatar={Boolean(avatarRef)}
          onFile={onFile}
          onAlbum={() => {
            setError(null);
            setAlbumOpen(true);
          }}
          onClear={() => {
            onChange(null);
            showPreview(null, false);
          }}
        />
      )}
      {sending && <p role="status">顔を送っています</p>}
      {error && <p role="alert">{error}</p>}
      {albumOpen && characterId && (
        <AvatarAlbumSheet
          characterId={characterId}
          sending={sending}
          onChoose={(item) =>
            apply(() => chooseAvatarImage(characterId, item.messageId), item.imageUrl, false)
          }
        />
      )}
    </section>
  );
};
