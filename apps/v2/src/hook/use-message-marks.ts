// RIT-204: メッセージへの印（ブックマーク・いいね）の読み込み・トグルをまとめるフック。
import { useCallback, useState, type RefObject } from "react";

import { loadMarks, toggleMark, type MessageMark } from "../lib/marks";

type UseMessageMarks = {
  marks: MessageMark[];
  reload: () => Promise<void>;
  toggle: (
    input: { messageId?: string; kind: "bookmark" | "feedback"; value?: 1 | -1 },
    onError: (cause: unknown) => void,
  ) => void;
};

export const useMessageMarks = (
  characterId: string,
  conversationId: RefObject<string | null>,
): UseMessageMarks => {
  const [marks, setMarks] = useState<MessageMark[]>([]);

  const reload = useCallback(async () => {
    const target = conversationId.current;
    if (!target) {
      setMarks([]);
      return;
    }
    const next = await loadMarks(characterId, target).catch(() => null);
    if (next) setMarks(next);
  }, [characterId, conversationId]);

  const toggle: UseMessageMarks["toggle"] = (input, onError) => {
    const target = conversationId.current;
    if (!target || input.messageId === undefined) return;
    void toggleMark(characterId, {
      conversationId: target,
      messageId: input.messageId,
      kind: input.kind,
      ...(input.value !== undefined ? { value: input.value } : {}),
    })
      .then(setMarks)
      .catch(onError);
  };

  return { marks, reload, toggle };
};
