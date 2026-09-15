import type { ReactNode } from "react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character } from "@/lib/api";

interface TalkSurfaceProps {
  character: Character | null;
  children: ReactNode;
}

export const TalkSurface = ({ character, children }: TalkSurfaceProps) => (
  <div className="fixed inset-0 overflow-hidden bg-[var(--bg)]">
    {character?.avatar ? (
      <AuthenticatedImage
        src={character.avatar}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover object-[center_15%]"
      />
    ) : null}
    <div
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(to bottom, rgba(9,7,5,.40) 0%, rgba(9,7,5,.06) 15%, rgba(9,7,5,.09) 29%, rgba(9,7,5,.36) 46%, rgba(9,7,5,.66) 62%, rgba(9,7,5,.88) 80%, rgba(8,6,5,.97) 100%)",
        pointerEvents: "none",
      }}
    />
    <div className="relative z-10 flex h-full flex-col">{children}</div>
  </div>
);
