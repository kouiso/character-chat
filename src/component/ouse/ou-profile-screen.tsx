import { useMemo, useState, type CSSProperties } from "react";

import { toast } from "sonner";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/component/ui/sheet";
import { useChatQuery } from "@/hook/use-chat-query";
import type { Character } from "@/lib/api";
import { visibleCharacterTags } from "@/lib/character-display-tag";
import { buildNaturalCharacterProfileText, parseSystemPrompt } from "@/lib/prompt-builder";

import { CharacterName } from "./character-name";
import { OU2 } from "./ouse-tokens";

interface OuProfileScreenProps {
  character: Character | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 主 CTA。既存の会話を「つづきから」開く側。意味は変えん */
  onStartTalk: () => void;
  /** この子と新しい会話を始める。openNewConversation は在ったのに、プロフィールの
      主 CTA は続きを開くだけで、新しく始める道が返信設定シートの中にしか無かった（#1484） */
  onStartNewConversation?: () => void;
  // 設計上プロフィール画面に編集導線は無いが、既存の呼び出し側との後方互換のため prop は残す
}

// OU2.night を alpha 化したガラス下地。トークンに night の半透明版が無いため局所定義する
const GLASS_BG = "rgba(20,15,13,.55)";
// タグ／カード枠は var(--lamp) を薄めた ramp で統一する（ハードコード hex を避ける）
const LAMP_TINT_BG = "color-mix(in srgb, var(--lamp) 16%, transparent)";
const LAMP_TINT_BORDER = "color-mix(in srgb, var(--lamp) 35%, transparent)";
const LAMP_CARD_BORDER = "color-mix(in srgb, var(--lamp) 28%, transparent)";

const floatingControlStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: GLASS_BG,
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  cursor: "pointer",
};

// 二次導線のボタン。主 CTA と見た目で並ばせんよう地は敷かず線だけで押さえる。
const secondaryActionStyle = (color: string): CSSProperties => ({
  flex: 1,
  minHeight: 44,
  padding: "11px 4px",
  borderRadius: 22,
  border: `1px solid ${OU2.hairline}`,
  background: "transparent",
  color,
  fontFamily: OU2.round,
  fontSize: 12,
  cursor: "pointer",
});

interface ProfileConversationActionsProps {
  characterId: string;
  characterName: string;
  onStartNewConversation?: () => void;
}

// 会話一覧を読むフックが要るので、character が null の時に早期 return する
// OuProfileScreen 本体とは別のコンポーネントに分ける。
const ProfileConversationActions = ({
  characterId,
  characterName,
  onStartNewConversation,
}: ProfileConversationActionsProps) => {
  // プロフィールは特定の会話を開いてへん。
  const { conversations, deleteConversationEntry } = useChatQuery(null);
  // 押し間違えても「やめる」で必ず戻れるよう、履歴画面と同じ二段にする。
  const [confirmRequested, setConfirmRequested] = useState(false);

  const targets = useMemo(
    () => conversations.filter((conv) => conv.characterId === characterId),
    [conversations, characterId],
  );

  // 消し切った後も確認状態が残ると、対象が無いのに「ぜんぶ消す」だけが画面に残る。
  // 状態として持たずに導出する。持つと effect で戻す羽目になって、描画が一巡余計に走る。
  const confirming = confirmRequested && targets.length > 0;

  const handleDelete = (): void => {
    setConfirmRequested(false);
    const ids = targets.map((conv) => conv.id);
    void Promise.allSettled(ids.map((id) => deleteConversationEntry(id))).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed === 0) toast.success(`${characterName}との会話を消しました`);
      else toast.error(`${failed}件の会話を消せませんでした`);
    });
  };

  if (!onStartNewConversation && targets.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", gap: 9, marginTop: 10 }}>
        {onStartNewConversation && (
          <button
            type="button"
            onClick={onStartNewConversation}
            style={secondaryActionStyle(OU2.text)}
          >
            はじめから話す
          </button>
        )}
        {targets.length > 0 &&
          (confirming ? (
            <>
              <button type="button" onClick={handleDelete} style={secondaryActionStyle(OU2.lamp)}>
                ぜんぶ消す
              </button>
              <button
                type="button"
                onClick={() => setConfirmRequested(false)}
                style={secondaryActionStyle(OU2.faint)}
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRequested(true)}
              aria-label={`${characterName}との会話を削除`}
              style={secondaryActionStyle(OU2.faint)}
            >
              会話を消す（{targets.length}件）
            </button>
          ))}
      </div>
      {onStartNewConversation && (
        <div
          style={{
            marginTop: 8,
            textAlign: "center",
            fontFamily: OU2.round,
            fontSize: 10.5,
            color: OU2.ghost,
          }}
        >
          「この子と話す」はつづきから。はじめから話しても、今までの会話は履歴に残ります
        </div>
      )}
    </>
  );
};

export const OuProfileScreen = ({
  character,
  open,
  onOpenChange,
  onStartTalk,
  onStartNewConversation,
}: OuProfileScreenProps) => {
  if (!character) return null;

  // 「年齢: 18歳成人」等のボイラープレートや 【設定】等の生マーカーを表示に出さないため、
  // 生の parseSystemPrompt 結果ではなく自然文プロフィールとして整形して見せる
  const personality = buildNaturalCharacterProfileText(
    parseSystemPrompt(character.systemPrompt).personality,
  );

  const displayTags = visibleCharacterTags(character.tags);

  // 認証フェッチ失敗時のフォールバックと avatar 未設定時の表示は同じ頭文字プレースホルダーなので共有する
  const avatarFallback = (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: OU2.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: OU2.serif,
        fontSize: 96,
        color: OU2.faint,
      }}
    >
      {character.name[0]}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="h-[92dvh] overflow-hidden rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)] p-0 shadow-[0_-24px_64px_rgba(5,3,2,.62)]"
      >
        <div
          style={{ position: "relative", display: "flex", height: "100%", flexDirection: "column" }}
        >
          {/* ヒーロー画像: 上部フルブリード。下端は night へフェードして本文へ繋げる */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 420 }}>
            {character.avatar ? (
              <AuthenticatedImage
                src={character.avatar}
                alt={character.name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "50% 10%",
                }}
                fallback={avatarFallback}
              />
            ) : (
              avatarFallback
            )}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(180deg, rgba(20,15,13,.35) 0%, rgba(20,15,13,0) 30%, rgba(20,15,13,.55) 72%, ${OU2.night} 100%)`,
              }}
            />
          </div>

          {/* 掴み代 */}
          <div
            aria-hidden
            style={{
              position: "relative",
              width: 44,
              height: 5,
              borderRadius: 99,
              background: OU2.ghost,
              margin: "10px auto 0",
            }}
          />

          {/* 浮遊コントロール: 戻る／お気に入り */}
          <div
            style={{
              position: "relative",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 22px 0",
            }}
          >
            <button
              type="button"
              aria-label="戻る"
              onClick={() => onOpenChange(false)}
              style={{ ...floatingControlStyle, fontSize: 17, color: OU2.text }}
            >
              ‹
            </button>
            {/* お気に入りは設計上の装飾。永続化ハンドラが無いため見た目のみ */}
            <span aria-hidden style={{ ...floatingControlStyle, fontSize: 16, color: OU2.lamp }}>
              ♡
            </span>
          </div>

          {/* ヒーローを見せるための余白 */}
          <div style={{ flex: 1, minHeight: 210 }} />

          {/* スクロール可能な本文（挨拶・性格が長い場合に備える） */}
          <div
            style={{
              position: "relative",
              overflowY: "auto",
              padding: "0 26px 12px",
              scrollbarWidth: "none",
            }}
          >
            {/* 名前 + 公式ピル */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <SheetTitle
                className="p-0"
                style={{
                  fontFamily: OU2.serif,
                  fontSize: 30,
                  fontWeight: 600,
                  color: OU2.text,
                  letterSpacing: "0.02em",
                }}
              >
                <CharacterName name={character.name} reading={character.nameReading} />
              </SheetTitle>
              {character.isOfficial && (
                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 11,
                    background: GLASS_BG,
                    fontFamily: OU2.round,
                    fontSize: 10,
                    color: OU2.lamp,
                  }}
                >
                  公式
                </span>
              )}
            </div>
            {/* 年齢データは Character に無いため省略（架空値を作らない） */}
            <SheetDescription className="sr-only">{character.name} のプロフィール</SheetDescription>

            {/* タグ: 左寄せ・lamp ガラス */}
            {displayTags.length > 0 && (
              <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                {displayTags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "5px 11px",
                      borderRadius: 13,
                      background: LAMP_TINT_BG,
                      border: `1px solid ${LAMP_TINT_BORDER}`,
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      fontFamily: OU2.round,
                      fontSize: 11.5,
                      color: OU2.text,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 性格・紹介文 */}
            {personality && (
              <div
                style={{
                  marginTop: 13,
                  fontFamily: OU2.round,
                  fontSize: 12.5,
                  lineHeight: 1.95,
                  color: OU2.dim,
                  whiteSpace: "pre-wrap",
                }}
              >
                {personality}
              </div>
            )}

            {/* はじまりのひと言 */}
            {character.greeting && (
              <div
                style={{
                  marginTop: 13,
                  padding: "13px 16px",
                  borderRadius: 16,
                  background: GLASS_BG,
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  border: `1px solid ${LAMP_CARD_BORDER}`,
                }}
              >
                <div
                  style={{
                    fontFamily: OU2.round,
                    fontSize: 10,
                    letterSpacing: "0.22em",
                    color: OU2.lamp,
                    marginBottom: 6,
                  }}
                >
                  はじまりのひと言
                </div>
                <div
                  style={{
                    fontFamily: OU2.serif,
                    fontSize: 14,
                    lineHeight: 1.85,
                    color: OU2.text,
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {character.greeting}
                </div>
              </div>
            )}
            {/* シーン数・プレイ回数は保持していないため統計行は省略（架空の数値を出さない） */}
          </div>

          {/* 主 CTA: この子と話す（つづきから）＋二次導線（はじめから／消す） */}
          <div
            style={{
              position: "relative",
              padding: "16px 24px calc(28px + env(safe-area-inset-bottom))",
              background: OU2.night,
            }}
          >
            <button
              type="button"
              onClick={onStartTalk}
              style={{
                width: "100%",
                padding: "15px 0",
                borderRadius: 26,
                border: "none",
                background: OU2.lampGrad,
                color: OU2.onLamp,
                fontFamily: OU2.round,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.04em",
                cursor: "pointer",
              }}
            >
              この子と話す →
            </button>
            <ProfileConversationActions
              characterId={character.id}
              characterName={character.name}
              onStartNewConversation={onStartNewConversation}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
