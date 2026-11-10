// RIT-30 ギャップ（Saylo の創作センター）: キャラの生成画像を first-frame にして
// ショート動画を作る。画像が無いキャラは選べない（まずチャットで画像を生成させる）。
import { useEffect, useRef, useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { listClipImages } from "../server/clips";
import { listCharacters } from "../server/characters";

import type { CharacterListItem } from "../server/characters";
import type { ClippableImage } from "../server/api-clips";

const routeApi = getRouteApi("/create");

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_TRIES = 60;

type CreateResult = { status: string; videoUrl?: string; reason?: string };

const ImageGrid = (props: {
  images: ClippableImage[];
  selected: string;
  disabled: boolean;
  onPick: (id: string) => void;
}) => (
  <fieldset className="v2-create-images">
    <legend>もとにする画像</legend>
    <ul>
      {props.images.map((image) => (
        <li key={image.imageGenerationId}>
          <button
            type="button"
            className={
              props.selected === image.imageGenerationId
                ? "v2-create-image selected"
                : "v2-create-image"
            }
            aria-label="この画像をもとにする"
            onClick={() => props.onPick(image.imageGenerationId)}
            disabled={props.disabled}
          >
            <img src={image.imageUrl} alt="" loading="lazy" />
          </button>
        </li>
      ))}
    </ul>
  </fieldset>
);

const CharacterSelect = (props: {
  characters: CharacterListItem[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) => (
  <label>
    キャラクター
    <select
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      disabled={props.disabled}
    >
      <option value="">選んでください</option>
      {props.characters.map((character) => (
        <option key={character.id} value={character.id}>
          {character.name}
        </option>
      ))}
    </select>
  </label>
);

const ResultView = ({ result }: { result: CreateResult }) => {
  if (result.status === "ok" && result.videoUrl) {
    return (
      <div className="v2-create-done">
        <p>出来ました。</p>
        <video className="v2-clip-video" src={result.videoUrl} controls playsInline autoPlay />
        <p>
          <Link to="/clips">クリップ一覧で見る</Link>
        </p>
      </div>
    );
  }
  if (result.status === "failed") {
    return <p className="v2-error">生成に失敗しました: {result.reason ?? "原因不明"}</p>;
  }
  return null;
};

const CreatePage = () => {
  const { characters } = routeApi.useLoaderData();
  const [characterId, setCharacterId] = useState("");
  const [images, setImages] = useState<ClippableImage[] | null>(null);
  const [imageId, setImageId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setImages(null);
    setImageId("");
    if (!characterId) return;
    void listClipImages({ data: characterId })
      .then(setImages)
      .catch(() => setImages([]));
  }, [characterId]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const poll = (clipId: string) => {
    let tries = 0;
    timer.current = setInterval(() => {
      tries += 1;
      void fetch(`/api/clips/${encodeURIComponent(clipId)}`)
        .then(
          async (res) =>
            (await res.json()) as { status: string; videoUrl?: string; failureReason?: string },
        )
        .then((body) => {
          if (body.status === "processing" && tries < POLL_MAX_TRIES) return;
          if (timer.current) clearInterval(timer.current);
          setBusy(false);
          setResult({ status: body.status, videoUrl: body.videoUrl, reason: body.failureReason });
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
  };

  const start = () => {
    if (busy || !characterId || !imageId) return;
    setBusy(true);
    setResult(null);
    void fetch("/api/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterId,
        imageGenerationId: imageId,
        instruction: instruction.trim() || undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `生成に失敗しました（${res.status}）`);
        }
        return (await res.json()) as { clipId: string };
      })
      .then(({ clipId }) => poll(clipId))
      .catch((cause: Error) => {
        setBusy(false);
        setResult({ status: "failed", reason: cause.message });
      });
  };

  return (
    <div className="v2-create">
      <header className="v2-page-head">
        <h1>創作センター</h1>
        <nav>
          <Link to="/clips">クリップ一覧へ</Link>
          <Link to="/">キャラ一覧へ</Link>
        </nav>
      </header>
      <p>チャットで生成した画像を first-frame にして、5秒のショート動画を作れます。</p>
      <CharacterSelect
        characters={characters}
        value={characterId}
        disabled={busy}
        onChange={setCharacterId}
      />
      {images !== null && images.length === 0 && (
        <p>このキャラにはまだ生成画像がありません。チャットで画像を生成してから使えます。</p>
      )}
      {images && images.length > 0 && (
        <ImageGrid images={images} selected={imageId} disabled={busy} onPick={setImageId} />
      )}
      <label>
        動きの指定（任意）
        <input
          type="text"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={400}
          placeholder="例: ゆっくり振り向く、微笑む"
          disabled={busy}
        />
      </label>
      <button type="button" onClick={start} disabled={busy || !characterId || !imageId}>
        {busy ? "生成中…" : "クリップを生成"}
      </button>
      {busy && <p>動画を生成しています。数分掛かることがあります。</p>}
      {result && <ResultView result={result} />}
    </div>
  );
};

export const Route = createFileRoute("/create")({
  loader: async () => ({ characters: await listCharacters() }),
  component: CreatePage,
});
