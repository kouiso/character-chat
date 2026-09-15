import type { ComponentType, SVGProps } from "react";

import { Home, Image, Moon, Search } from "lucide-react";

import { OU2 } from "./ouse-tokens";

import type { OuScreen } from "./ouse-screen-types";

type TabScreen = Extract<OuScreen, "home" | "discover" | "photo" | "my">;

interface OuBottomNavProps {
  screen: OuScreen;
  onScreen: (screen: TabScreen) => void;
}

const TABS: { id: TabScreen; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: "home", label: "ホーム", Icon: Home },
  { id: "discover", label: "さがす", Icon: Search },
  { id: "photo", label: "アルバム", Icon: Image },
  { id: "my", label: "マイ", Icon: Moon },
];

export const OuBottomNav = ({ screen, onScreen }: OuBottomNavProps) => (
  <nav
    aria-label="メインタブ"
    style={{
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 40,
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      padding: "8px 12px calc(8px + env(safe-area-inset-bottom))",
      borderTop: `1px solid ${OU2.hairline}`,
      background: OU2.night,
      boxShadow: "0 -18px 44px rgba(0,0,0,.32)",
    }}
  >
    {TABS.map(({ id, label, Icon }) => {
      const active = screen === id;
      return (
        <button
          key={id}
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => onScreen(id)}
          style={{
            display: "flex",
            minHeight: 52,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: active ? OU2.lamp : OU2.faint,
            fontFamily: OU2.round,
            fontSize: 11,
            letterSpacing: "0.14em",
            cursor: "pointer",
          }}
        >
          <Icon width={22} height={22} strokeWidth={active ? 2.2 : 1.8} />
          <span>{label}</span>
        </button>
      );
    })}
  </nav>
);
