import type { JSX } from "react";

import { handleNavClick } from "@/lib/navigation";

interface NotFoundViewProps {
  path: string;
}

export const NotFoundView = ({ path }: NotFoundViewProps): JSX.Element => (
  <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
    <p className="font-narrative text-5xl font-semibold tracking-widest text-white/80">404</p>
    <h1 className="text-lg font-semibold text-white/90">そのページは見つかりませんでした</h1>
    <p className="max-w-sm break-all text-sm text-white/50">{path}</p>
    <a
      href="/"
      onClick={handleNavClick("/")}
      className="mt-2 inline-flex min-h-11 items-center rounded-md bg-white/10 px-5 text-sm text-white/90 transition-colors hover:bg-white/20"
    >
      ホームへ戻る
    </a>
  </div>
);
