import { useEffect, useState } from "react";

const HEALTH_ENDPOINT = "/api/health";
const POLL_INTERVAL_MS = 5_000;
const PING_TIMEOUT_MS = 3_000;
// 起動直後の ping はバンドル取得・フォント・初回 API と帯域を奪い合って時間切れになる。
// 1回落ちただけの状態は「まだ繋がっとらん」であって「切れた」やない。この2つを同じ
// false に潰しとったせいで、冷えた起動の利用者が最初に見るのが再接続バナーやった。
// 連続で落ちて初めて切断と見なす。
const OFFLINE_FAILURE_STREAK = 2;

// SSR/テスト環境では navigator が無いのでオンライン扱い（初回送信を止めない）。
const getNavigatorOnLine = (): boolean =>
  typeof navigator !== "undefined" ? navigator.onLine : true;

export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(() => getNavigatorOnLine());

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 集計はこの effect の実行ごとに閉じる。ref で共有しとった時は、張り直した
    // effect が cancelled を false へ戻した瞬間に、捨てたはずの前回の ping が
    // 生き返って同じ失敗を二重に数えた。StrictMode の二重マウントや Fast Refresh の
    // 起動直後にこれが起き、1回きりの時間切れが「連続2回」に化けてバナーが出とった。
    let cancelled = false;
    let failureStreak = 0;
    // 一度も疎通が取れてへんうちは、つなぎ直す先がまだ無い。ここを切断と同じ false に
    // 潰すと「つなぎ直しています…」が嘘になる。ブラウザ自身の offline 宣言だけは
    // 疎通実績を待たずに信じる。
    let hasConnected = false;

    const ping = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      try {
        await fetch(`${HEALTH_ENDPOINT}?t=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;
        failureStreak = 0;
        hasConnected = true;
        setIsOnline(true);
      } catch {
        if (cancelled) return;
        failureStreak += 1;
        if (hasConnected && failureStreak >= OFFLINE_FAILURE_STREAK) setIsOnline(false);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const handleOnline = () => {
      failureStreak = 0;
      setIsOnline(true);
      void ping();
    };
    // ブラウザ自身が回線断を宣言した場合だけは、裏取りを待たず1回で切断と見なす。
    const handleOffline = () => {
      failureStreak = OFFLINE_FAILURE_STREAK;
      hasConnected = true;
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 初回マウント時も navigator.onLine を疑わず裏取りする。
    void ping();
    const intervalId = window.setInterval(() => void ping(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(intervalId);
    };
  }, []);

  return isOnline;
};
