import { StrictMode } from "react";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { ErrorBoundary } from "./component/error-boundary";
import "./index.css";
import { ensureAuthToken } from "./lib/auth-session";
import { migrateLegacyHash } from "./lib/navigation";
import { queryClient } from "./lib/query-client";
import { queryPersister } from "./lib/query-persister";

// 旧ハッシュ URL(`/#/chat` 等)のブックマーク・共有リンクを新パスへ置換してから描画する。
migrateLegacyHash();

// バックグラウンドで auth_token を確保する。CF Access cookie が切れていても
// 有効な auth_token があれば API は通り続けるためユーザーの再ログインを防ぐ。
void ensureAuthToken();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: 1000 * 60 * 60 * 24,
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
