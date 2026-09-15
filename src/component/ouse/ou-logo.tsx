import { useId } from "react";

import { OU2 } from "./ouse-tokens";

// 燈（ともしび）マーク — Create Flow Explorations 2f 準拠。
// 「夜の部屋にひとつだけ灯る炎」。炎の中に灯芯のしずくを抜く（negative space）。

interface FlameDefsProps {
  glow: boolean;
  gradient: boolean;
  glowId: string;
  flameId: string;
}

const FlameDefs = ({ glow, gradient, glowId, flameId }: FlameDefsProps) => (
  <defs>
    {glow && (
      <radialGradient id={glowId} cx="50%" cy="42%" r="52%">
        <stop offset="0%" stopColor={OU2.lampGold} stopOpacity="0.34" />
        <stop offset="100%" stopColor={OU2.lampGold} stopOpacity="0" />
      </radialGradient>
    )}
    {gradient && (
      <linearGradient id={flameId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={OU2.logoFlameLight} />
        <stop offset="100%" stopColor={OU2.lampGold} />
      </linearGradient>
    )}
  </defs>
);

interface OuFlameMarkProps {
  size?: number;
  // にじみ（glow）は暗地のみ許可（設計注記）
  glow?: boolean;
  // 炎の塗り: "gradient"（暗地）/ 単色 hex（明地は #b08545、最小サイズは単色シルエット）
  tone?: "gradient" | string;
  // 抜き（灯芯のしずく）の色 = マーク背後の地の色。単色シルエット時は無視
  cutout?: string;
  // 最小サイズ用: 抜き・しずくを省いた単色シルエット
  minimal?: boolean;
  className?: string;
}

export const OuFlameMark = ({
  size = 24,
  glow = false,
  tone = "gradient",
  cutout = OU2.logoInk,
  minimal = false,
  className,
}: OuFlameMarkProps) => {
  // 複数インスタンスで gradient id が衝突しないよう一意化する
  const uid = useId().replace(/:/g, "");
  const glowId = `ouFlameGlow-${uid}`;
  const flameId = `ouFlameFill-${uid}`;
  const gradient = tone === "gradient";
  const flameFill = gradient ? `url(#${flameId})` : tone;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <FlameDefs glow={glow} gradient={gradient} glowId={glowId} flameId={flameId} />
      {glow && <circle cx="32" cy="30" r="30" fill={`url(#${glowId})`} />}
      <path
        d="M32 12 C37 21 44 25.5 44 35 A12 12 0 1 1 20 35 C20 25.5 27 21 32 12 Z"
        fill={flameFill}
      />
      {!minimal && (
        <>
          <path
            d="M32 26 C34.4 30.5 37.6 32.8 37.6 37.4 A5.6 5.6 0 1 1 26.4 37.4 C26.4 32.8 29.6 30.5 32 26 Z"
            fill={cutout}
          />
          <circle cx="32" cy="38.6" r="2.1" fill={OU2.logoFlameLight} />
        </>
      )}
    </svg>
  );
};
