import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character } from "@/lib/api";

import { CharacterName } from "./character-name";
import { OU2 } from "./ouse-tokens";

interface TalkHeaderProps {
  character: Character | null;
  onMenuOpen: () => void;
  onPersonOpen?: () => void;
  onBackToHome?: () => void;
  /** 現在のシーン名（直近の <scene> タグから抽出）。ヘッダタイトルの「キャラ名 — 場面名」に使う */
  sceneLabel?: string;
}

interface HeaderActionsProps {
  onMenuOpen: () => void;
}

// ヘッダー右側に配置するアクション操作（メニュー）を一元管理するため
// 案A「燈」にはシーン選択ボタンが無いため削除（2026-07-15 局長確認: モバイルでのシーン再選択導線は別途検討）
const HeaderActions = ({ onMenuOpen }: HeaderActionsProps) => (
  <div className="pointer-events-auto flex shrink-0 items-center gap-2">
    <button
      type="button"
      onClick={onMenuOpen}
      className="relative flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-full text-[16px] leading-none transition-colors"
      style={{ border: `1px solid ${OU2.avatarRing}`, color: OU2.headerAction }}
      aria-label="メニューを開く"
    >
      ⋯
    </button>
  </div>
);

// 案A「燈」L55: 36px円アバター。character.avatar が無い、または読み込み失敗した場合は先頭文字のプレースホルダ
const HeaderAvatar = ({ character }: { character: Character | null }) => {
  const initial = character?.name?.trim()?.[0] ?? "?";
  const letterFallback = (
    <span
      aria-hidden
      className="text-[13px]"
      style={{ color: OU2.subtitle, fontFamily: OU2.serif }}
    >
      {initial}
    </span>
  );
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ border: `1px solid ${OU2.avatarRing}` }}
    >
      {character?.avatar ? (
        <AuthenticatedImage
          src={character.avatar}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          style={{ objectPosition: "50% 20%" }}
          fallback={letterFallback}
        />
      ) : (
        letterFallback
      )}
    </div>
  );
};

// 案A「燈」: アバターは HeaderAvatar として隣に置き、ここはタイトル/サブタイトルのテキストのみを担う
const HeaderTitle = ({
  character,
  sceneLabel,
  onPersonOpen,
}: {
  character: Character | null;
  sceneLabel?: string;
  onPersonOpen?: () => void;
}) => (
  // 局長報告 2026-08-18: 顔写真を押しても何も起きん。名前だけがこのボタンで、
  // アバターは外に置かれた素の <div> やった。行き先は同じなので、別ボタンを足して
  // 読み上げの的を 2 つにするより、アバターごと包んで 1 つのタップ領域にする。
  <button
    type="button"
    onClick={onPersonOpen}
    disabled={!character || !onPersonOpen}
    className="pointer-events-auto inline-flex h-11 min-h-11 min-w-0 flex-1 items-center gap-[14px] text-left disabled:pointer-events-none"
    aria-label={character ? "その人のこと" : undefined}
  >
    <HeaderAvatar character={character} />
    <div
      className="truncate text-[16.5px] font-semibold"
      style={{ fontFamily: OU2.serif, color: OU2.headerName }}
    >
      {character ? <CharacterName name={character.name} reading={character.nameReading} /> : ""}
      {character && sceneLabel ? ` — ${sceneLabel}` : ""}
    </div>
    {/*
      関係性とプレイ回数のサブタイトルは design の literal 値をそのまま出しており、
      初対面のキャラでも「恋人 ・ 128回プレイ」と断定していた。裏付けるデータが
      Character にも会話側にも無いので、実データに繋がるまで行ごと出さない（issue #920）。
    */}
  </button>
);

export const TalkHeader = ({
  character,
  onMenuOpen,
  onPersonOpen,
  onBackToHome,
  sceneLabel,
}: TalkHeaderProps) => (
  <header
    className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex flex-col"
    // 写真背景を廃した案A背景に馴染ませるための上端フェード（フラット背景専用ヘッダー）
    style={{
      background: `linear-gradient(180deg, ${OU2.night} 0%, rgba(20,15,13,.92) 78%, rgba(20,15,13,0) 100%)`,
    }}
  >
    <div className="flex items-center gap-[14px] px-[22px] pb-4 pt-[14px]">
      {onBackToHome && (
        <button
          type="button"
          onClick={onBackToHome}
          className="pointer-events-auto inline-flex h-12 w-12 min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full text-[22px] leading-none transition-colors hover:opacity-80"
          style={{ color: OU2.chrome }}
          aria-label="ホームへ戻る"
        >
          ‹
        </button>
      )}
      <HeaderTitle character={character} sceneLabel={sceneLabel} onPersonOpen={onPersonOpen} />
      <HeaderActions onMenuOpen={onMenuOpen} />
    </div>
    <div
      className="mx-[22px] h-px"
      style={{
        background: `linear-gradient(90deg, transparent, ${OU2.hairlineWarm}, transparent)`,
      }}
    />
  </header>
);
