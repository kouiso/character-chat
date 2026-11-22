import { Link, useRouterState } from "@tanstack/react-router";

import "./app-tab-bar.css";

type TabIconProps = { children: React.ReactNode };

// アイコンは Kit/Main の下タブの線画（24 グリッド・線幅 1.75）をそのまま写している
const TabIcon = ({ children }: TabIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

type TabDef = {
  label: string;
  to: "/" | "/catalog" | "/create" | "/album" | "/my";
  // 帯を出さん画面から戻ってきた時も、同じ系統の画面なら該当タブを点ける
  owns: (path: string) => boolean;
  icon: React.ReactNode;
};

const startsWithSegment = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`);

export const TABS: readonly TabDef[] = [
  {
    label: "ホーム",
    to: "/",
    owns: (path) => path === "/",
    icon: (
      <TabIcon>
        <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z" />
      </TabIcon>
    ),
  },
  {
    label: "出会う",
    to: "/catalog",
    owns: (path) => startsWithSegment(path, "/catalog"),
    icon: (
      <TabIcon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
      </TabIcon>
    ),
  },
  {
    label: "つくる",
    // 板 Create がタブの根。新しい子・ストーリー・クリップ・グループはその奥
    to: "/create",
    owns: (path) =>
      ["/characters", "/create", "/stories", "/clips", "/groups"].some((base) =>
        startsWithSegment(path, base),
      ),
    icon: (
      <TabIcon>
        <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
        <path d="M14 7l3 3" />
      </TabIcon>
    ),
  },
  {
    label: "アルバム",
    to: "/album",
    owns: (path) => startsWithSegment(path, "/album"),
    icon: (
      <TabIcon>
        <rect x="3.5" y="7" width="14" height="12" rx="2.5" />
        <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4H19a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5h-1.5" />
        <path d="M4.5 16.5l3.5-3.5 3 3 2-2 4 4" />
      </TabIcon>
    ),
  },
  {
    label: "マイ",
    to: "/my",
    owns: (path) => startsWithSegment(path, "/my"),
    icon: (
      <TabIcon>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </TabIcon>
    ),
  },
];

// つくるの奥（戻るの付く画面）は板 ClipCreate・Clips・Stories・Groups・CreateWizard とも帯が無い。
// 帯を出すのはタブの根の /create だけ
const isMakeSubScreen = (path: string) =>
  path === "/characters/new" ||
  ["/clips", "/stories", "/groups"].some((base) => startsWithSegment(path, base));

// マイの奥（戻るの付く画面）も帯を出さない（板 Settings・Notifications・LearnedPrefs・History に帯は無い）
const isMySubScreen = (path: string) =>
  startsWithSegment(path, "/settings") || startsWithSegment(path, "/notifications");

// Talk（会話・グループ会話）とリーダーは絵と入力欄が画面いっぱいなので、ボードどおり帯を出さない
const isImmersive = (path: string) =>
  startsWithSegment(path, "/chat") ||
  /^\/groups\/[^/]+/.test(path) ||
  /^\/stories\/[^/]+\/read/.test(path) ||
  isMakeSubScreen(path) ||
  isMySubScreen(path);

export const AppTabBar = () => {
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (isImmersive(path)) return null;

  return (
    <nav className="v2-tabbar" aria-label="メイン">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="v2-tabbar-item"
          aria-current={tab.owns(path) ? "page" : undefined}
        >
          <span className="v2-tabbar-pill">{tab.icon}</span>
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
};
