import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import {
  GroupCreateDialog,
  type GroupCreateCharacter,
} from "@/component/group/group-create-dialog";
import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { listGroups } from "@/lib/api";
import { queryKey } from "@/lib/query-key";

import { OU2 } from "./ouse-tokens";

interface OuUtageScreenProps {
  // 宴の会話は /groups/<id> の一枚画面。ここで抱え込むと一覧用のタブバーが会話に重なる。
  onOpenGroup: (groupId: string) => void;
  onBack: () => void;
  characters: GroupCreateCharacter[];
}

export const OuUtageScreen = ({ onOpenGroup, onBack, characters }: OuUtageScreenProps) => {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: groups = [], isPending } = useQuery({
    queryKey: queryKey.groupList,
    queryFn: listGroups,
  });

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        // 下部タブバーは position:fixed で重なるため、他の全画面(ホーム/マイ)と同じ 104px を空けて
        // 「宴を開く」がバーの下へ潜らんようにする。
        padding: "4px 0 104px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 親(ou-app)はタイトルを供給しないため画面ヘッダをここで持つ。 */}
      <div style={{ padding: "14px 26px 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
              fontSize: 18,
              color: OU2.dim,
              cursor: "pointer",
            }}
          >
            ‹
          </button>
          <div style={{ fontFamily: OU2.serif, fontSize: 23, fontWeight: 600, color: OU2.text }}>
            宴
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: OU2.faint, marginTop: 4, marginLeft: 30 }}>
          ふたりじゃない夜も。
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {isPending ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <Loader2 style={{ width: 20, height: 20, color: OU2.faint }} className="animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div
            style={{
              margin: "16px 12px",
              padding: "24px 16px",
              borderRadius: 12,
              border: `1px dashed ${OU2.hairline}`,
              textAlign: "center",
              fontFamily: OU2.round,
              fontSize: 13,
              color: OU2.faint,
              lineHeight: 1.8,
            }}
          >
            まだ宴がありません
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 24px" }}>
            {groups.map((group) => {
              // list API は characters(名前・顔) を返すが 発言回数・最終発言は持たないため省略する。
              const members = group.characters ?? [];
              const pair = members.slice(0, 2);
              const memberNames = members.map((character) => character.name).join("・");
              const metaParts = [memberNames, `${group.characterIds.length}人の宴`].filter(Boolean);
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => onOpenGroup(group.id)}
                  style={{
                    background: "rgba(20,15,13,.4)",
                    border: `1px solid ${OU2.hairline}`,
                    borderRadius: 20,
                    padding: 16,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "block",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {pair.length > 0 && (
                      <div style={{ display: "flex", flexShrink: 0 }}>
                        {pair.map((character, index) => (
                          <div
                            key={character.id}
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: "50%",
                              overflow: "hidden",
                              border: `2px solid ${OU2.night}`,
                              marginLeft: index === 0 ? 0 : -14,
                              background: OU2.hairline,
                            }}
                          >
                            {character.avatar && (
                              <AuthenticatedImage
                                src={character.avatar}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                // 認証フェッチ失敗時も丸アバターの枠が消えず頭文字で埋まるようにする
                                fallback={
                                  <div
                                    aria-hidden
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontFamily: OU2.serif,
                                      fontSize: 16,
                                      color: OU2.faint,
                                    }}
                                  >
                                    {character.name[0]}
                                  </div>
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: OU2.serif,
                          fontSize: 16,
                          color: OU2.text,
                          letterSpacing: "0.04em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.name}
                      </div>
                      {metaParts.length > 0 && (
                        <div
                          style={{
                            fontFamily: OU2.round,
                            fontSize: 11,
                            color: OU2.faint,
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {metaParts.join(" ・ ")}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: OU2.lamp, flexShrink: 0 }}>つづき →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ padding: "12px 24px 8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            width: "100%",
            fontFamily: OU2.round,
            fontSize: 14,
            fontWeight: 700,
            padding: "15px 0",
            borderRadius: 26,
            border: "none",
            // 設計のプライマリ CTA は充填ゴールドグラデ + 暗色テキスト。
            background: OU2.lampGrad,
            color: OU2.onLamp,
            cursor: "pointer",
            transition: "transform 0.15s",
          }}
        >
          宴を開く
        </button>
      </div>
      <GroupCreateDialog
        open={createOpen}
        characters={characters}
        onOpenChange={setCreateOpen}
        onCreated={(group) => {
          void queryClient.invalidateQueries({ queryKey: queryKey.groupList });
          onOpenGroup(group.id);
        }}
      />
    </div>
  );
};
