// <a onClick> から使う際に必要な最小のクリックイベント形。React.MouseEvent は
// これに構造的に代入可能なので、lib 層が react へ依存せずに済む。
export interface NavClickEvent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
}

// History API ベースのルーティングのソース。ハッシュではなく実パス+クエリを使う。
// pushState/replaceState はイベントを発火しないため、アプリ内遷移は
// ROUTE_CHANGE_EVENT で通知し、ブラウザ戻る/進むは popstate で拾う。
export const ROUTE_CHANGE_EVENT = "app:routechange";

// 旧 `#/...` 形式や先頭スラッシュ無しの入力も受けて `/...` へ正規化する。
const normalizePath = (path: string): string => {
  let normalized = path.startsWith("#") ? path.slice(1) : path;
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized;
};

// 現在のパス+クエリ。ルート解析への入力に使う。
export const getRoutePath = (): string =>
  typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;

// 旧ハッシュURL(`/#/chat?conv=x`)を新パス(`/chat?conv=x`)へ一度だけ置換する。
// 既存ブックマーク・共有リンクの後方互換のため起動時に呼ぶ。
export const migrateLegacyHash = (): void => {
  if (typeof window === "undefined") return;
  const { hash } = window.location;
  if (!hash.startsWith("#/")) return;
  window.history.replaceState(null, "", hash.slice(1));
};

const emitRouteChange = (): void => {
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
};

// アプリ内遷移。同一パスなら履歴を汚さず何もしない。
export const pushPath = (path: string): void => {
  const next = normalizePath(path);
  if (next === getRoutePath()) return;
  window.history.pushState(null, "", next);
  emitRouteChange();
};

// 現在の履歴エントリを置き換える。画面/会話の URL 同期など、戻る対象を増やしたくない遷移に使う。
export const replacePath = (path: string): void => {
  const next = normalizePath(path);
  if (next === getRoutePath()) return;
  window.history.replaceState(null, "", next);
  emitRouteChange();
};

// <a href="/..."> の既定遷移(フルリロード)を止めて SPA 内遷移にする onClick。
// 修飾キー付き/中クリックは新規タブ等のブラウザ既定に委ねる。
export const handleNavClick =
  (path: string) =>
  (event: NavClickEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    pushPath(path);
  };
