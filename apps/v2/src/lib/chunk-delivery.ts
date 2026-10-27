export type DeliveryChunk = { seq: number; text: string; scheduledAt: number | null };

export type ChunkDeliverySnapshot = {
  conversationId: string;
  turn: number;
  serverNow: number;
  chunks: DeliveryChunk[];
};

export type DeliveredChunk = DeliveryChunk & { id: string };
export type ChunkDeliveryView = { visible: DeliveredChunk[]; pending: boolean };

const MAX_TIMER_MS = 2_147_483_647;

const normalizedChunks = (chunks: readonly DeliveryChunk[]): DeliveryChunk[] =>
  [...new Map(chunks.map((chunk) => [chunk.seq, chunk])).values()].sort((a, b) => a.seq - b.seq);

// 同じ予定をキー順や受信順だけで別配送と見なすと、表示済みの塊まで再び隠れてまう。
export const chunkDeliverySignature = (snapshot: ChunkDeliverySnapshot): string =>
  JSON.stringify([
    snapshot.conversationId,
    snapshot.turn,
    normalizedChunks(snapshot.chunks).map((chunk) => [chunk.seq, chunk.text, chunk.scheduledAt]),
  ]);

export const createChunkDeliveryStore = (snapshot: ChunkDeliverySnapshot) => {
  let sampledAt = performance.now();
  let sampledServerNow = snapshot.serverNow;
  let latestServerNow = snapshot.serverNow;
  const chunks = normalizedChunks(snapshot.chunks).map((chunk) => ({
    ...chunk,
    id: `${snapshot.conversationId}:${snapshot.turn}:${chunk.seq}`,
  }));
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const currentTime = (): number => {
    latestServerNow = Math.max(
      latestServerNow,
      sampledServerNow + Math.max(0, performance.now() - sampledAt),
    );
    return latestServerNow;
  };

  const countDue = (serverNow: number): number => {
    const future = chunks.findIndex(
      (chunk) => chunk.scheduledAt !== null && chunk.scheduledAt > serverNow,
    );
    return future < 0 ? chunks.length : future;
  };

  let visibleCount = countDue(snapshot.serverNow);
  let view: ChunkDeliveryView = {
    visible: chunks.slice(0, visibleCount),
    pending: visibleCount < chunks.length,
  };
  const initialView = view;

  const refresh = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    // 端末の壁時計変更で予定を早めたり巻き戻したりせんよう、受信後の経過だけを使う。
    const serverNow = currentTime();
    const due = countDue(serverNow);
    if (due !== visibleCount) {
      visibleCount = due;
      view = { visible: chunks.slice(0, due), pending: due < chunks.length };
      for (const listener of listeners) listener();
    }
    const nextAt = chunks[visibleCount]?.scheduledAt;
    if (listeners.size > 0 && nextAt !== undefined && nextAt !== null) {
      timer = setTimeout(refresh, Math.min(MAX_TIMER_MS, Math.max(0, nextAt - serverNow)));
    }
  };

  const onVisible = (): void => {
    if (document.visibilityState === "visible") refresh();
  };

  return {
    advanceTo: (serverNow: number): void => {
      // 遅れて届いた時刻で表示済み本文を隠さず、新しいサーバ時刻だけを取り込む。
      sampledServerNow = Math.max(currentTime(), serverNow);
      sampledAt = performance.now();
      refresh();
    },
    getSnapshot: (): ChunkDeliveryView => view,
    getServerSnapshot: (): ChunkDeliveryView => initialView,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("pageshow", refresh);
        window.addEventListener("focus", refresh);
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          if (timer !== undefined) clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("pageshow", refresh);
          window.removeEventListener("focus", refresh);
        }
      };
    },
  };
};
