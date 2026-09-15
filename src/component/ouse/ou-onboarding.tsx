import { useMemo, useState } from "react";

import { saveOnboarding } from "@/lib/onboarding-state";

import { OU2 } from "./ouse-tokens";

// オンボーディング（設計 2d）: 3タップで「今夜の気分」を選び、最初の子へ。
// 登録は求めない — まず会わせる。選択は端末に残し、あとで設定からいくらでも変えられる。

type Axis = "distance" | "partner" | "tone";

interface Group {
  axis: Axis;
  label: string;
  options: string[];
}

const GROUPS: Group[] = [
  { axis: "distance", label: "距離感", options: ["甘やかされたい", "攻めたい"] },
  { axis: "partner", label: "相手", options: ["年上", "同い年", "年下"] },
  { axis: "tone", label: "ことば", options: ["タメ口", "敬語", "どちらでも"] },
];

interface OuOnboardingProps {
  onComplete: () => void;
}

export const OuOnboarding = ({ onComplete }: OuOnboardingProps) => {
  const [picks, setPicks] = useState<Partial<Record<Axis, string>>>({});
  const allPicked = useMemo(() => GROUPS.every((g) => picks[g.axis]), [picks]);

  const finish = () => {
    saveOnboarding(picks as Record<string, string>);
    onComplete();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        background: `radial-gradient(120% 60% at 50% -6%, ${OU2.ink} 0%, ${OU2.nightMid} 52%, ${OU2.night} 100%)`,
        color: OU2.text,
      }}
    >
      <div style={{ padding: "calc(env(safe-area-inset-top) + 22px) 28px 0" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", color: OU2.lamp }}>はじめまして</div>
        <div
          style={{
            fontFamily: OU2.serif,
            fontSize: 22,
            fontWeight: 600,
            color: OU2.text,
            marginTop: 8,
            lineHeight: 1.7,
          }}
        >
          今夜は、どんなひとに
          <br />
          会いたい気分？
        </div>
        <div style={{ fontSize: 11.5, color: OU2.faint, marginTop: 8 }}>
          3つ選ぶだけ。あとでいくらでも変えられます。
        </div>
      </div>

      <div
        className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 26px" }}
      >
        {GROUPS.map((group) => (
          <div key={group.axis} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.2em",
                color: OU2.lamp,
                marginBottom: 9,
              }}
            >
              {group.label}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {group.options.map((option) => {
                const active = picks[group.axis] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPicks((prev) => ({ ...prev, [group.axis]: option }))}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      borderRadius: 15,
                      background: active ? OU2.lamp : "transparent",
                      border: active ? "none" : `1px solid ${OU2.hairline}`,
                      color: active ? OU2.night : OU2.dim,
                      fontFamily: OU2.round,
                      fontSize: 12.5,
                      fontWeight: active ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {allPicked && (
          <div
            style={{
              marginTop: 8,
              borderRadius: 18,
              border: `1px solid ${OU2.lampDim}`,
              background: "rgba(214,160,84,.08)",
              padding: "15px 17px",
              display: "flex",
              alignItems: "center",
              gap: 13,
            }}
          >
            <div
              style={{
                flex: 1,
                fontSize: 12,
                lineHeight: 1.7,
                color: OU2.dim,
              }}
            >
              あなたの夜を用意しています…
              <br />
              <b style={{ color: OU2.lamp }}>ぴったりの子</b>が待っていそう。
            </div>
            <span
              className="animate-spin"
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: `2px solid ${OU2.hairline}`,
                borderTopColor: OU2.lamp,
              }}
              aria-hidden
            />
          </div>
        )}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          padding: "12px 24px calc(env(safe-area-inset-bottom) + 26px)",
          background: OU2.barBg,
          borderTop: `1px solid ${OU2.hairline}`,
        }}
      >
        <button
          type="button"
          onClick={finish}
          disabled={!allPicked}
          style={{
            width: "100%",
            textAlign: "center",
            padding: "15px 0",
            borderRadius: 26,
            border: "none",
            background: allPicked ? OU2.lampGrad : "rgba(214,169,87,.28)",
            color: allPicked ? OU2.onLamp : OU2.faint,
            fontFamily: OU2.round,
            fontSize: 14,
            fontWeight: 700,
            cursor: allPicked ? "pointer" : "default",
            transition: "background .2s, color .2s",
          }}
        >
          会いに行く →
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: OU2.faint, marginTop: 10 }}>
          登録はあとでOK。まず会ってから。
        </div>
      </div>
    </div>
  );
};
