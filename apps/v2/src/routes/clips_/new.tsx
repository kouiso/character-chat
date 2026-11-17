// RIT-30 ギャップ（Saylo の創作センター）: キャラの生成画像を first-frame にして
// ショート動画を作る（板 ClipCreate）。画像が無いキャラは選べない（まずトークで画像を生成させる）。
import { useEffect, useRef, useState } from "react";

import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router";

import { ArrowIcon, ErrorCard, Face, SubHeader } from "../../component/make-screen";
import { dayLabel } from "../../lib/day-label";
import { listCharacters } from "../../server/characters";
import { listClipImages } from "../../server/clips";

import "../../component/clip-screen.css";

import type { ClippableImage } from "../../server/api-clips";
import type { CharacterListItem } from "../../server/characters";

const routeApi = getRouteApi("/clips_/new");

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_TRIES = 60;

type Phase =
  | { kind: "form" }
  | { kind: "busy"; clipId: string; tries: number }
  | { kind: "done"; videoUrl: string }
  | { kind: "failed" };

// 選ぶ札は名前の後ろ（下の名前）だけ。板の 5 列に収める
const shortName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

const CheckIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const ClipHeader = () => <SubHeader title="クリップをつくる" back="/create" />;

// 板の 5 列 × 2 段まで見せ、残りは「もっと見る」でひらく（子が多いと画面が札で埋まるため）
const PICKER_FOLDED = 10;

const CharacterPicker = (props: {
  characters: CharacterListItem[];
  value: string;
  onPick: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const shown = open ? props.characters : props.characters.slice(0, PICKER_FOLDED);
  return (
    <div className="v2-clip-field">
      <h2 className="v2-clip-label">キャラ</h2>
      <div role="radiogroup" aria-label="キャラ" className="v2-clip-picker">
        {shown.map((character) => {
          const selected = character.id === props.value;
          return (
            <button
              key={character.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={character.name}
              className="v2-clip-pick"
              onClick={() => props.onPick(character.id)}
            >
              <span className="v2-clip-pick-face">
                <Face id={character.id} name={character.name} avatar={character.avatar} />
                {selected && (
                  <span className="v2-clip-pick-check" aria-hidden="true">
                    <CheckIcon size={14} />
                  </span>
                )}
              </span>
              <span className="v2-clip-pick-name">{shortName(character.name)}</span>
            </button>
          );
        })}
      </div>
      {props.characters.length > PICKER_FOLDED && (
        <button
          type="button"
          className="v2-make-quiet-link v2-clip-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "たたむ" : "もっと見る"}
        </button>
      )}
    </div>
  );
};

const ImagePicker = (props: {
  character: CharacterListItem | undefined;
  images: ClippableImage[] | null;
  failed: boolean;
  selected: string;
  onPick: (id: string) => void;
  onRetry: () => void;
}) => {
  const body = () => {
    if (!props.character) return <p className="v2-clip-hint">先にキャラを選んでください。</p>;
    if (props.failed)
      return <ErrorCard message="画像を読み込めませんでした。" onRetry={props.onRetry} />;
    if (props.images === null)
      return (
        <div role="status" aria-label="読み込んでいます" className="v2-make-tiles">
          {[0, 1, 2].map((key) => (
            <span key={key} className="v2-clip-image skeleton" />
          ))}
        </div>
      );
    if (props.images.length === 0)
      return (
        <div className="v2-clip-none">
          <p>
            この子の画像はまだありません。
            <br />
            トークで画像をもらうと、ここで使えます。
          </p>
          <Link
            to="/chat/$id"
            params={{ id: props.character.id }}
            className="v2-make-surface-button small"
          >
            <span>{props.character.name}と話す</span>
            <ArrowIcon size={18} />
          </Link>
        </div>
      );
    return (
      <ul className="v2-make-tiles">
        {props.images.map((image) => {
          const day = dayLabel(image.createdAt);
          const selected = props.selected === image.imageGenerationId;
          return (
            <li key={image.imageGenerationId} className="v2-clip-image-cell">
              <button
                type="button"
                aria-label={`この画像をもとにする ${day}`}
                aria-pressed={selected}
                className="v2-clip-image"
                onClick={() => props.onPick(image.imageGenerationId)}
              >
                <img src={image.imageUrl} alt="" loading="lazy" />
                {selected && (
                  <>
                    <span className="v2-clip-image-ring" aria-hidden="true" />
                    <span className="v2-clip-image-check" aria-hidden="true">
                      <CheckIcon size={18} />
                    </span>
                  </>
                )}
              </button>
              <span className="v2-clip-image-day">{day}</span>
            </li>
          );
        })}
      </ul>
    );
  };
  return (
    <div className="v2-clip-field">
      <div className="v2-clip-label-row">
        <h2 className="v2-clip-label">もとにする画像</h2>
        {props.images && props.images.length > 0 && (
          <span className="v2-clip-label-note">新しい順</span>
        )}
      </div>
      {body()}
    </div>
  );
};

const Subject = (props: {
  character: CharacterListItem;
  imageUrl: string | undefined;
  instruction: string;
  videoUrl?: string;
}) => (
  <div className="v2-clip-subject">
    <div className="v2-clip-stage">
      {props.videoUrl ? (
        <video src={props.videoUrl} controls playsInline autoPlay />
      ) : (
        props.imageUrl && <img src={props.imageUrl} alt="" />
      )}
    </div>
    <div className="v2-clip-subject-row">
      <Face id={props.character.id} name={props.character.name} avatar={props.character.avatar} />
      <span className="v2-make-row-text">
        <span className="v2-make-row-name">{props.character.name}</span>
        {props.instruction && <span className="v2-make-row-note">{props.instruction}</span>}
      </span>
    </div>
  </div>
);

const ToList = ({ primary }: { primary?: boolean }) => (
  <Link to="/clips" className={primary ? "v2-make-primary v2-clip-grow" : "v2-make-surface-button"}>
    <span>一覧へ</span>
    <ArrowIcon size={primary ? 20 : 18} />
  </Link>
);

// つくっている途中とできあがりの画面（板 ClipCreate「つくっています」「できました」）
const ClipProgressView = ({
  character,
  imageUrl,
  instruction,
  phase,
  onAgain,
}: {
  character: CharacterListItem;
  imageUrl: string | undefined;
  instruction: string;
  phase: Extract<Phase, { kind: "busy" } | { kind: "done" }>;
  onAgain: () => void;
}) => (
  <main className="v2-make">
    <ClipHeader />
    <div className="v2-clip-body">
      {phase.kind === "done" && <h2 className="v2-clip-done-title">できました</h2>}
      <Subject
        character={character}
        imageUrl={imageUrl}
        instruction={instruction}
        videoUrl={phase.kind === "done" ? phase.videoUrl : undefined}
      />
      {phase.kind === "busy" ? (
        <>
          <div className="v2-clip-progress-block">
            <div className="v2-clip-progress-card" role="status">
              <span className="v2-make-row-name">クリップをつくっています</span>
              <div className="v2-clip-progress" aria-hidden="true">
                <div
                  style={{
                    width: `${Math.min(90, Math.round((phase.tries / POLL_MAX_TRIES) * 100) + 8)}%`,
                  }}
                />
              </div>
            </div>
            <p className="v2-clip-hint">
              数分かかります。
              <br />
              この画面を閉じても、できあがると一覧に並びます。
            </p>
          </div>
          <ToList />
        </>
      ) : (
        <div className="v2-clip-actions">
          <button type="button" className="v2-clip-quiet" onClick={onAgain}>
            もう 1 本つくる
          </button>
          <ToList primary />
        </div>
      )}
    </div>
  </main>
);

const ClipCreatePage = () => {
  const { characters } = routeApi.useLoaderData();
  const [characterId, setCharacterId] = useState("");
  const [images, setImages] = useState<ClippableImage[] | null>(null);
  const [imagesFailed, setImagesFailed] = useState(false);
  const [imagesKey, setImagesKey] = useState(0);
  const [imageId, setImageId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const character = characters.find((item) => item.id === characterId);
  const image = images?.find((item) => item.imageGenerationId === imageId);

  useEffect(() => {
    setImages(null);
    setImagesFailed(false);
    setImageId("");
    if (!characterId) return;
    void listClipImages({ data: characterId })
      .then(setImages)
      .catch(() => setImagesFailed(true));
  }, [characterId, imagesKey]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const poll = (clipId: string) => {
    let tries = 0;
    setPhase({ kind: "busy", clipId, tries });
    timer.current = setInterval(() => {
      tries += 1;
      void fetch(`/api/clips/${encodeURIComponent(clipId)}`)
        .then(async (res) => (await res.json()) as { status: string; videoUrl?: string })
        .then((body) => {
          if (body.status === "processing" && tries < POLL_MAX_TRIES) {
            setPhase({ kind: "busy", clipId, tries });
            return;
          }
          if (timer.current) clearInterval(timer.current);
          setPhase(
            body.status === "ok" && body.videoUrl
              ? { kind: "done", videoUrl: body.videoUrl }
              : { kind: "failed" },
          );
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
  };

  const start = () => {
    if (phase.kind === "busy" || !characterId || !imageId) return;
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
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { clipId: string };
      })
      .then(({ clipId }) => poll(clipId))
      .catch(() => setPhase({ kind: "failed" }));
  };

  if (character && (phase.kind === "busy" || phase.kind === "done")) {
    return (
      <ClipProgressView
        character={character}
        imageUrl={image?.imageUrl}
        instruction={instruction.trim()}
        phase={phase}
        onAgain={() => {
          setPhase({ kind: "form" });
          setImageId("");
          setInstruction("");
        }}
      />
    );
  }

  const ready = Boolean(characterId && imageId);
  return (
    <main className="v2-make">
      <ClipHeader />
      <div className="v2-clip-body form">
        <p className="v2-clip-lead">
          トークで届いた画像が、
          <br />
          短いクリップになります。
        </p>
        <CharacterPicker characters={characters} value={characterId} onPick={setCharacterId} />
        <ImagePicker
          character={character}
          images={images}
          failed={imagesFailed}
          selected={imageId}
          onPick={setImageId}
          onRetry={() => setImagesKey((key) => key + 1)}
        />
        <div className="v2-clip-field">
          <label htmlFor="clip-motion" className="v2-clip-label">
            動きの指定（任意）
          </label>
          <input
            id="clip-motion"
            type="text"
            className="v2-clip-input"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={400}
            placeholder="例: ゆっくり振り向く、微笑む"
          />
          <div className="v2-clip-hint">空のままなら、元の画像の雰囲気のまま動きます。</div>
        </div>
        {phase.kind === "failed" && (
          <ErrorCard
            message="クリップをつくれませんでした。"
            note="入れた内容は残っています。"
            onRetry={start}
          />
        )}
        <div className="v2-clip-submit">
          {!ready && <p className="v2-clip-hint center">キャラと画像を選ぶと、つくれます。</p>}
          <button type="button" className="v2-make-primary" onClick={start} disabled={!ready}>
            <span>クリップをつくる</span>
          </button>
        </div>
      </div>
    </main>
  );
};

const ClipCreateError = () => {
  const router = useRouter();
  return (
    <main className="v2-make">
      <ClipHeader />
      <div className="v2-clip-body">
        <ErrorCard
          message="画像を読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/clips_/new")({
  loader: async ({ abortController }) => ({
    characters: await listCharacters({ signal: abortController.signal }),
  }),
  errorComponent: ClipCreateError,
  component: ClipCreatePage,
});
