import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import {
  filterSceneCardsForCharacter,
  getSceneCardCharacterName,
  sceneCards,
} from "@/data/scene-cards";

import { OU2 } from "./ouse-tokens";

interface OuScenePickerProps {
  characterId: string | null;
  characterName: string;
  onBack: () => void;
  onSelect: (firstMessage: string) => void;
}

// 設計 D-frame 共通の room 背景（3-stop）。中間層 nightMid を 54% に挟む。
const bg = `radial-gradient(120% 60% at 50% -6%, ${OU2.ink} 0%, ${OU2.nightMid} 54%, ${OU2.night} 100%)`;
// hero 下部スクリム。OU2.night(#140f0d=rgb(20,15,13)) の透明→不透明だが、
// アルファ付き night トークンが無いため rgba で表現する。
const heroScrim = "linear-gradient(180deg, rgba(20,15,13,.05) 0%, rgba(20,15,13,.94) 100%)";

// シーンチップの当たりだけ 44px へ広げる。::before は描画にも layout にも出ないので、
// 30px 高の詰まった見た目は保ったまま指の当たりだけが大きくなる。
const CHIP_TOUCH_TARGET =
  "relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

// avatar が無いキャラでも崩れないよう頭文字フォールバックを描く共通サムネイル。
// size/radius を変えて header(38 円)・resume(46 角丸)双方に使う。
const Thumb = ({
  avatar,
  name,
  size,
  radius,
  objectPosition,
}: {
  avatar?: string;
  name: string;
  size: number;
  radius: number;
  objectPosition: string;
}) => {
  const placeholder = (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${OU2.hairline}`,
        background: "linear-gradient(135deg, rgba(214,169,87,.32), rgba(243,234,217,.08))",
        color: OU2.dim,
        fontFamily: OU2.serif,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {name[0] ?? "宵"}
    </div>
  );

  if (avatar) {
    return (
      <AuthenticatedImage
        src={avatar}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          flex: "none",
          objectFit: "cover",
          objectPosition,
          border: `1px solid ${OU2.hairline}`,
        }}
        fallback={placeholder}
      />
    );
  }

  return placeholder;
};

export const OuScenePicker = ({
  characterId,
  characterName,
  onBack,
  onSelect,
}: OuScenePickerProps) => {
  const cards = filterSceneCardsForCharacter(sceneCards, { id: characterId, name: characterName });
  // データはシーンの「進行中/新規」を区別しないため、先頭を hero、続きを再開行、
  // 残りを新規シーン chip に割り当てる。空でも各段が単に描かれないだけで壊れない。
  const heroCard = cards[0];
  const resumeCards = cards.slice(1, 3);
  const starterCards = cards.slice(3);
  const heroAvatar = heroCard?.character.avatar;
  // avatar 未設定・認証フェッチ失敗のどちらでも hero カードの高さ(150)を保ち、
  // 下に重なるタイトル/CTA の位置が崩れないようにする共通の gradient プレースホルダ。
  const heroPlaceholder = (
    <div
      aria-hidden
      style={{
        width: "100%",
        height: 150,
        background: "linear-gradient(135deg, rgba(214,169,87,.32), rgba(243,234,217,.08))",
      }}
    />
  );

  return (
    <section
      aria-label={`${characterName} のシーン`}
      data-screen-label="シーン"
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: bg }}
    >
      <header
        style={{
          position: "absolute",
          top: 48,
          left: 20,
          right: 20,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 13,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="戻る"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            minHeight: 44,
            border: "none",
            background: "transparent",
            color: OU2.dim,
            fontFamily: OU2.serif,
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ‹
        </button>
        <Thumb
          avatar={heroAvatar}
          name={characterName}
          size={38}
          radius={99}
          objectPosition="50% 18%"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: OU2.serif,
              fontSize: 17,
              fontWeight: 600,
              color: OU2.text,
            }}
          >
            {characterName} のシーン
          </h1>
          <div style={{ fontSize: 11, color: OU2.faint, marginTop: 2 }}>
            記憶と関係はシーンをまたいで続きます
          </div>
        </div>
      </header>

      <div
        style={{
          position: "absolute",
          top: 104,
          left: 20,
          right: 20,
          bottom: 20,
          overflowY: "auto",
          scrollbarWidth: "none",
        }}
      >
        {heroCard ? (
          <button
            type="button"
            onClick={() => onSelect(heroCard.firstMessage)}
            style={{
              position: "relative",
              display: "block",
              width: "100%",
              padding: 0,
              marginBottom: 14,
              borderRadius: 20,
              overflow: "hidden",
              border: `1px solid ${OU2.lampDim}`,
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {heroAvatar ? (
              <AuthenticatedImage
                src={heroAvatar}
                alt=""
                style={{
                  display: "block",
                  width: "100%",
                  height: 150,
                  objectFit: "cover",
                  objectPosition: "50% 14%",
                }}
                fallback={heroPlaceholder}
              />
            ) : (
              heroPlaceholder
            )}
            <div style={{ position: "absolute", inset: 0, background: heroScrim }} />
            <div style={{ position: "absolute", left: 16, right: 16, bottom: 13 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.22em", color: OU2.lamp }}>
                いま進行中
              </div>
              <div
                style={{
                  fontFamily: OU2.serif,
                  fontSize: 17,
                  fontWeight: 600,
                  color: OU2.text,
                  marginTop: 4,
                }}
              >
                {heroCard.title}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 5,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color: OU2.dim,
                    fontStyle: "italic",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  「{heroCard.firstMessage}」
                </span>
                <span style={{ fontSize: 11, color: OU2.lamp, flex: "none" }}>つづきから →</span>
              </div>
            </div>
          </button>
        ) : null}

        {resumeCards.map((card) => {
          const name = getSceneCardCharacterName(card);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.firstMessage)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                width: "100%",
                padding: "12px 4px",
                border: "none",
                borderBottom: `1px solid ${OU2.hairline}`,
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Thumb
                avatar={card.character.avatar}
                name={name}
                size={46}
                radius={13}
                objectPosition="50% 34%"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: OU2.serif, fontSize: 14.5, color: OU2.text }}>
                  {card.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: OU2.faint,
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.summary}
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: OU2.dim, flex: "none" }}>再開</span>
            </button>
          );
        })}

        <div
          style={{ fontSize: 11, letterSpacing: "0.2em", color: OU2.lamp, margin: "20px 0 10px" }}
        >
          あたらしいシーンをはじめる
        </div>
        {/* rowGap を 14 にしてあるのは、チップの当たり（44px）が上下 7px ずつ
            はみ出すため。8 のままだと折り返した行同士で当たりが重なり、
            上の行のチップを狙ったタップが下の行へ吸われる。 */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: 8,
            rowGap: 14,
            marginBottom: 12,
          }}
        >
          {starterCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.firstMessage)}
              className={CHIP_TOUCH_TARGET}
              style={{
                padding: "8px 14px",
                borderRadius: 17,
                border: `1px solid ${OU2.hairline}`,
                background: "transparent",
                color: OU2.dim,
                fontSize: 12,
                fontFamily: OU2.round,
                cursor: "pointer",
              }}
            >
              {card.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSelect("")}
            className={CHIP_TOUCH_TARGET}
            style={{
              padding: "8px 14px",
              borderRadius: 17,
              border: `1px dashed ${OU2.lampDim}`,
              background: "transparent",
              color: OU2.faint,
              fontSize: 12,
              fontFamily: OU2.round,
              cursor: "pointer",
            }}
          >
            自由に書く…
          </button>
        </div>

        <div
          style={{
            borderRadius: 16,
            border: `1px dashed ${OU2.lampDim}`,
            padding: "13px 16px",
            fontSize: 11.5,
            lineHeight: 1.75,
            color: OU2.faint,
          }}
        >
          ❝ シナリオを貼り付けて、この子とその物語を始めることもできます
        </div>
      </div>
    </section>
  );
};
