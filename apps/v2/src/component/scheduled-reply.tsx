import { useChunkDelivery } from "../lib/use-chunk-delivery";

import { ChatMessage } from "./chat-message";

import type { ChunkDeliverySnapshot } from "../lib/chunk-delivery";

export const ScheduledReply = ({
  snapshot,
  characterName,
}: {
  snapshot: ChunkDeliverySnapshot;
  characterName: string;
}) => {
  const delivery = useChunkDelivery(snapshot);
  return (
    <>
      {delivery.visible.map((chunk) => (
        <div
          key={chunk.id}
          className="v2-bubble v2-message-turn assistant"
          data-chunk-id={chunk.id}
        >
          <ChatMessage role="assistant" text={chunk.text} characterName={characterName} />
        </div>
      ))}
      {delivery.pending && (
        <div className="v2-bubble assistant pending" role="status">
          入力中
        </div>
      )}
    </>
  );
};
