// 出会うの「とっておく」API クライアント（板 Meet の右送りが残す印）。
export const setCharacterKept = async (characterId: string): Promise<void> => {
  const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/keep`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`とっておけませんでした（${res.status}）`);
};

export const unsetCharacterKept = async (characterId: string): Promise<void> => {
  const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/keep`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`外せませんでした（${res.status}）`);
};
