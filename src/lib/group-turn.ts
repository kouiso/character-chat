export const selectRoundRobinSpeaker = (
  characterIds: string[],
  recentAssistantCount: number,
): string | null => {
  if (characterIds.length === 0) return null;
  const normalizedCount = Math.max(0, recentAssistantCount);
  return characterIds[normalizedCount % characterIds.length] ?? null;
};
