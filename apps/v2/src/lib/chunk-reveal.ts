import type { ChatBubble } from "./chat-session";

// 予定が来た塊を順に出す。過ぎた分はまとめて出るので、裏タブに回っても
// visibilitychange の時点で経過分が一気に揃う（RIT-69）。
// sendAt は最初の塊からの経過ミリ秒。端末の時計はサーバとずれるので、絶対時刻としては読まず、
// 先頭を引いた間隔だけを使って baseAt（最初の塊を受け取った端末の時刻）から引き直す。
// こうすると旧形式の絶対時刻も同じ間隔として読め、生成で待たされた分は間から差し引かれる。
export const scheduleReveal = (
  texts: string[],
  sendAt: number[] | undefined,
  reveal: (text: string, more: boolean) => void,
  baseAt: number = Date.now(),
): (() => void) => {
  const dueAt = sendAt?.map((at) => baseAt + Math.max(at - sendAt[0], 0));
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const now = Date.now();
    while (index < texts.length) {
      const due = dueAt?.[index];
      if (due !== undefined && due > now) break;
      reveal(texts[index], index + 1 < texts.length);
      index++;
    }
    if (index < texts.length) {
      timer = setTimeout(flush, Math.max(dueAt![index] - Date.now(), 16));
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      if (timer !== undefined) clearTimeout(timer);
      flush();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  flush();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
};

// 末尾の「入力中」塊の直前へ、届いた分の吹き出しを積む。全部届いたら入力中を外す。
export const revealChunk = (prev: ChatBubble[], chunkText: string, more: boolean): ChatBubble[] => {
  const last = prev.at(-1);
  const base = last?.role === "assistant" && last.pending ? prev.slice(0, -1) : prev;
  const grown = [...base, { role: "assistant" as const, text: chunkText }];
  return more ? [...grown, { role: "assistant" as const, text: "", pending: true }] : grown;
};
