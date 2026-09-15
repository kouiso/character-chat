import type { ReactNode } from "react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character } from "@/lib/api";

import { OU2 } from "./ouse-tokens";

interface OuStageProps {
  character: Character | null;
  children: ReactNode;
  /**
   * "talk" は案A「燈」設計のフラット背景 + lamp glow。
   * "flat" は home/discover/photo 等の全画面系で、背景だけ共有し glow は出さない。
   * "photo" は既存のキャラ全画面写真背景。
   */
  variant?: "photo" | "flat" | "talk";
}

export const OuStage = ({ character, children, variant = "photo" }: OuStageProps) => {
  if (variant === "flat" || variant === "talk") {
    return (
      <div className="ou-stage">
        <div
          className="ou-stage-flat-bg"
          aria-hidden
          style={{
            background: `radial-gradient(125% 78% at 50% -8%, ${OU2.ink} 0%, ${OU2.nightMid} 52%, ${OU2.night} 100%)`,
          }}
        />
        {/* 案A「燈」の lamp glow。キーフレームは既にあるが create-flow だけに繋がっており、
            トーク画面は均一なグラデーションのままやった（監査 2026-07-21）。
            寸法 340x280 は設計ボード準拠（.ou-stage の overflow:hidden で上端 90px が切れる前提）。 */}
        {variant === "talk" && (
          <span
            aria-hidden="true"
            className="create-flow-lamp-glow pointer-events-none absolute -top-[90px] left-1/2 h-[280px] w-[340px] -translate-x-1/2 rounded-full blur-[4px]"
            style={{
              background: `radial-gradient(closest-side, ${OU2.lampGlow}, transparent 72%)`,
            }}
          />
        )}
        {children}
      </div>
    );
  }

  return (
    <div className="ou-stage">
      <div className="ou-face-fallback" aria-hidden />
      {character?.avatar && (
        <AuthenticatedImage
          src={character.avatar}
          alt=""
          aria-hidden
          className="ou-face"
          style={{ objectFit: "cover", objectPosition: "center 15%" }}
        />
      )}
      <div className="ou-vign" aria-hidden />
      <div className="ou-scrim" aria-hidden />
      {children}
    </div>
  );
};
