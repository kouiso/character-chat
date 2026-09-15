import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import type { ConversationSummary } from "@/lib/api";
import { listBranches } from "@/lib/api";

import { OU2 } from "./ouse-tokens";

interface OuBranchTreeProps {
  conversationId?: string | null;
  onOpen: (conversationId: string, characterId?: string) => void;
}

// 琥珀ハイライトカードの下地。lamp 系の淡い面色に相当するトークンが無いため局所定義する。
const LAMP_TINT = "rgba(214,169,87,.12)";
const NODE_BG = "rgba(20,15,13,.4)";

const formatBranchLabel = (createdAt?: number): string => {
  if (!createdAt) return "if ・ 分岐";
  const date = new Date(createdAt);
  return `if ・ ${date.getMonth() + 1}/${date.getDate()}に分岐`;
};

const ellipsis = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

const BranchCard = ({
  branch,
  onOpen,
}: {
  branch: ConversationSummary;
  onOpen: (id: string, characterId?: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onOpen(branch.id, branch.characterId)}
    style={{
      display: "block",
      width: "100%",
      textAlign: "left",
      borderRadius: 14,
      border: `1px solid ${OU2.hairline}`,
      background: NODE_BG,
      padding: "11px 13px",
      marginBottom: 9,
      cursor: "pointer",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: OU2.dim, ...ellipsis }}>
        {formatBranchLabel(branch.createdAt)}
      </span>
      <span style={{ fontSize: 10, color: OU2.faint, flexShrink: 0 }}>このルートへ →</span>
    </div>
    <div
      style={{
        fontFamily: OU2.serif,
        fontSize: 12,
        color: OU2.dim,
        marginTop: 5,
        ...ellipsis,
      }}
    >
      {branch.title}
    </div>
    {branch.lastAssistantMessage ? (
      <div
        style={{ fontFamily: OU2.round, fontSize: 11, color: OU2.faint, marginTop: 3, ...ellipsis }}
      >
        {branch.lastAssistantMessage}
      </div>
    ) : null}
  </button>
);

export const OuBranchTree = ({ conversationId, onOpen }: OuBranchTreeProps) => {
  const { data: branches = [], isPending } = useQuery({
    queryKey: ["branches", conversationId ?? null],
    queryFn: () => listBranches(conversationId!),
    enabled: !!conversationId,
  });

  const centerStyle = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: OU2.faint,
    fontFamily: OU2.round,
    fontSize: 13,
    letterSpacing: "0.06em",
  };

  if (!conversationId) {
    return <div style={centerStyle}>会話を始めると分岐が現れます</div>;
  }

  if (isPending) {
    return (
      <div style={centerStyle}>
        <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: "8px 2px 16px", overflowY: "auto" }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.7, color: OU2.faint, marginBottom: 14 }}>
        どの夜も、なかったことにできる。栞から別の展開へ。
      </div>

      <div style={{ position: "relative", paddingLeft: 26 }}>
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            bottom: 8,
            width: 1,
            background: OU2.hairline,
          }}
        />

        {/* 起点＝いまのルート。琥珀ハイライトで現在地を示す */}
        <div style={{ position: "relative", marginBottom: 18 }}>
          <span
            style={{
              position: "absolute",
              left: -20,
              top: 6,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: OU2.lamp,
              boxShadow: `0 0 10px ${OU2.lampDim}`,
            }}
          />
          <div
            style={{
              borderRadius: 14,
              border: `1px solid ${OU2.lampDim}`,
              background: LAMP_TINT,
              padding: "11px 13px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: OU2.lamp }}>いまのルート</span>
              <span style={{ fontSize: 10, color: OU2.faint }}>表示中</span>
            </div>
            <div style={{ fontSize: 12, color: OU2.dim, marginTop: 5 }}>
              このまま、いまのルートのつづき
            </div>
          </div>
        </div>

        {/* 分岐グループ（if の栞） */}
        <div
          style={{
            marginLeft: 14,
            paddingLeft: 18,
            borderLeft: `1px dashed ${OU2.lampDim}`,
            marginBottom: 14,
          }}
        >
          {branches.length === 0 ? (
            <div
              style={{
                paddingBottom: 12,
                color: OU2.faint,
                fontFamily: OU2.round,
                fontSize: 12,
                letterSpacing: "0.06em",
              }}
            >
              まだ分岐はありません
            </div>
          ) : (
            branches.map((branch) => <BranchCard key={branch.id} branch={branch} onOpen={onOpen} />)
          )}
          {/* 分岐作成はこの場ではなく発言の長押しメニューから行う。ボタンに見えないよう控えめな案内にする */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 15px",
              borderRadius: 16,
              border: `1px dashed ${OU2.hairline}`,
              fontSize: 11.5,
              color: OU2.faint,
            }}
          >
            別の夜は、発言を長押しして挟む
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.75, color: OU2.faint, marginTop: 14 }}>
        ・栞は発言の長押しメニュー「ここから別の夜を」からも挟める
        <br />
        ・記憶（◆）はルートをまたいで共有。ルート限定にもできる
      </div>
    </div>
  );
};
