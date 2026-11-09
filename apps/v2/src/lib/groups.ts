// パーティモードのクライアント（RIT-216）。
export type GroupReply = {
  speakerCharacterId: string;
  text: string;
  voiceMismatch: number;
};

export const createGroup = async (input: {
  title: string;
  characterIds: string[];
}): Promise<{ id: string }> => {
  const res = await fetch("/api/groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "場を作成できませんでした。");
  }
  return await res.json();
};

export const postGroupMessage = async (
  groupId: string,
  content: string,
): Promise<{ replies: GroupReply[] }> => {
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "送信できませんでした。");
  }
  return await res.json();
};
