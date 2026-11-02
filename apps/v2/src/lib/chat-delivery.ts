import { useEffect, useState } from "react";

import type { ChatBubble } from "./chat-session";

export const projectDelivery = (bubbles: ChatBubble[], receivedNow: number) => {
  let nextDelay = Infinity;
  const visible = bubbles.map((bubble) => {
    if (!bubble.delivery) return bubble;
    const { chunks, serverTime, receivedAt } = bubble.delivery;
    const now = serverTime + Math.max(0, receivedNow - receivedAt);
    const ready: string[] = [];
    let waiting = false;
    for (const chunk of chunks) {
      if (chunk.scheduledAt > now) {
        waiting = true;
        nextDelay = Math.min(nextDelay, chunk.scheduledAt - now);
      } else {
        ready.push(chunk.text);
      }
    }
    return { ...bubble, text: ready.join("\n\n"), pending: waiting };
  });
  return { visible, waiting: Number.isFinite(nextDelay), nextDelay };
};

export const useChatDelivery = (bubbles: ChatBubble[]) => {
  const [now, setNow] = useState(0);
  const receivedAt = bubbles.reduce(
    (latest, bubble) => Math.max(latest, bubble.delivery?.receivedAt ?? 0),
    0,
  );
  const delivery = projectDelivery(bubbles, Math.max(now, receivedAt));
  useEffect(() => {
    const refresh = () => setNow(performance.now());
    const timer = Number.isFinite(delivery.nextDelay)
      ? window.setTimeout(
          refresh,
          Math.max(1, Math.min(Math.ceil(delivery.nextDelay), 2_147_483_647)),
        )
      : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [bubbles, delivery.nextDelay]);
  return delivery;
};
