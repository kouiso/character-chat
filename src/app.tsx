import { lazy, Suspense, useEffect, useState, type JSX } from "react";

import { GroupView } from "@/component/group/group-view";
import { AgeDeniedScreen } from "@/component/legal/age-denied-screen";
import { AgeGateModal } from "@/component/legal/age-gate-modal";
import { PrivacyPolicy } from "@/component/legal/privacy-policy";
import { TermsOfService } from "@/component/legal/terms-of-service";
import { Tokushoho } from "@/component/legal/tokushoho";
import { OuApp } from "@/component/ouse";
import { OuOnboarding } from "@/component/ouse/ou-onboarding";
import { PwaUpdateBanner } from "@/component/pwa/pwa-update-banner";
import { NotFoundView } from "@/component/route/not-found-view";
import { SettingsPanel } from "@/component/settings/settings-panel";
import { SharedConversationView } from "@/component/share/shared-conversation-view";
import { Toaster } from "@/component/ui/sonner";
import { LEGAL_ROUTES, parseRoute, type AppRoute } from "@/lib/app-route";
import { getRoutePath, handleNavClick, pushPath, ROUTE_CHANGE_EVENT } from "@/lib/navigation";
import { hasOnboarded } from "@/lib/onboarding-state";

// admin 専用画面。一般ユーザーのメインバンドルから分離するため遅延読み込みする
const AdminView = lazy(() =>
  import("@/component/admin/admin-view").then((module) => ({ default: module.AdminView })),
);

const getPageTitle = (route: AppRoute): string => {
  if (route.page !== "legal") return route.page === "chat" ? "逢" : "出会い";

  switch (route.route) {
    case LEGAL_ROUTES.tos:
      return "利用規約";
    case LEGAL_ROUTES.tokushoho:
      return "特定商取引法表示";
    case LEGAL_ROUTES.privacy:
      return "プライバシーポリシー";
    default:
      return "逢";
  }
};

const renderLegalPageContent = (route: AppRoute) => {
  if (route.page !== "legal") return null;

  switch (route.route) {
    case LEGAL_ROUTES.tos:
      return <TermsOfService />;
    case LEGAL_ROUTES.tokushoho:
      return <Tokushoho />;
    case LEGAL_ROUTES.privacy:
      return <PrivacyPolicy />;
    default:
      return null;
  }
};

const renderMainContent = (input: {
  route: AppRoute;
  navigate: (path: string) => void;
}): JSX.Element => {
  const { route, navigate } = input;

  if (route.page === "legal") return renderLegalPageContent(route) ?? <></>;
  if (route.page === "group") return <GroupView groupId={route.groupId} onRoute={navigate} />;
  if (route.page === "share")
    return <SharedConversationView shareId={route.shareId} focusMessageId={route.focusMessageId} />;
  if (route.page === "admin")
    return (
      <Suspense fallback={null}>
        <AdminView />
      </Suspense>
    );
  if (route.page === "not-found") return <NotFoundView path={route.path} />;
  return <OuApp route={route} />;
};
export const App = (): JSX.Element => {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(getRoutePath()));
  const [isAgeDenied, setIsAgeDenied] = useState(false);
  // 初回のみの世界観導入（設計 2d）。年齢確認を通過したメイン画面でのみ出す
  const [needsOnboarding, setNeedsOnboarding] = useState(() => !hasOnboarded());

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    // アプリ内遷移(pushPath/replacePath)は ROUTE_CHANGE_EVENT、ブラウザ戻る/進むは popstate で拾う。
    // parseRoute は呼ぶたびに新規オブジェクトを返すため、素朴に setRoute すると同じルートで
    // 2回連続 re-render してしまう。内容が変わっていなければ前の state を再利用して更新をスキップする。
    const syncRoute = () => {
      setRoute((prev) => {
        const next = parseRoute(getRoutePath());
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      });
    };

    window.addEventListener(ROUTE_CHANGE_EVENT, syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  const navigate = (path: string): void => {
    pushPath(path);
  };
  const pageTitle = getPageTitle(route);
  const isLegalRoute = route.page === "legal";
  // OuApp（メインのモバイル体験）が描画される route でのみ初回導入を出す
  const isMainApp = !["legal", "group", "share", "admin", "not-found"].includes(route.page);
  // AdminView は min-h-screen でスクロール前提のレイアウトのため、chat 画面用の
  // overflow-hidden コンテナに包むとコンテンツが見切れる（PR #700 レビュー指摘）
  const isScrollableRoute = isLegalRoute || route.page === "admin";
  if (isAgeDenied) {
    // 年齢確認へ戻せば AgeGateModal が未確認状態で再マウントされ、確認からやり直せる
    return <AgeDeniedScreen onReconsider={() => setIsAgeDenied(false)} />;
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* legal ページのみヘッダーを表示。タップターゲットを 44px 以上に統一し、戻るリンクを左上に独立配置する */}
      {isLegalRoute && (
        <header className="bg-gradient-header">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
            <a
              href="/discover"
              onClick={handleNavClick("/discover")}
              aria-label="発見に戻る"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 py-2 text-sm text-white/90 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden className="text-base leading-none">
                ←
              </span>
              戻る
            </a>
            <h1 className="min-w-0 flex-1 truncate font-narrative text-lg font-semibold tracking-wide text-white/95">
              {pageTitle}
            </h1>
          </div>
        </header>
      )}
      <main className={isScrollableRoute ? "flex-1 overflow-y-auto" : "flex-1 overflow-hidden"}>
        {renderMainContent({
          route,
          navigate,
        })}
      </main>
      <SettingsPanel />
      {/* 初回のみ。年齢ゲート(後段の Radix ダイアログ)が上に重なり、承認後に現れる */}
      {isMainApp && needsOnboarding && (
        <OuOnboarding onComplete={() => setNeedsOnboarding(false)} />
      )}
      {/* 法務ページはゲートの下に敷くと同意を求めとる文章に到達でけへん。
          規約・プライバシーは年齢に関わらず読めるようゲートを出さん */}
      {!isLegalRoute && <AgeGateModal onDenied={() => setIsAgeDenied(true)} />}
      <Toaster
        position="top-center"
        richColors
        closeButton
        offset={16}
        toastOptions={{
          classNames: { toast: "max-w-[90vw]" },
        }}
      />
      {/* Toaster(top-center) と衝突しないよう、PWA更新バナーは bottom 配置 */}
      <PwaUpdateBanner />
    </div>
  );
};
