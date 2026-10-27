import { useLayoutEffect, useState, useSyncExternalStore } from "react";

import {
  chunkDeliverySignature,
  createChunkDeliveryStore,
  type ChunkDeliverySnapshot,
} from "./chunk-delivery";

export const useChunkDelivery = (snapshot: ChunkDeliverySnapshot) => {
  const signature = chunkDeliverySignature(snapshot);
  const [current, setCurrent] = useState(() => ({
    signature,
    store: createChunkDeliveryStore(snapshot),
  }));
  // 同じ配送を再受信しても時計の基準を作り直さん。別の配送だけを置き換える。
  if (current.signature !== signature) {
    setCurrent({ signature, store: createChunkDeliveryStore(snapshot) });
  }
  useLayoutEffect(() => {
    current.store.advanceTo(snapshot.serverNow);
  }, [current.store, snapshot.serverNow]);
  return useSyncExternalStore(
    current.store.subscribe,
    current.store.getSnapshot,
    current.store.getServerSnapshot,
  );
};
