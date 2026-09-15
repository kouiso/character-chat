export interface CharacterRecommendation {
  suggestedPersonality: string;
  suggestedScenario: string;
  suggestedTags: string[];
  suggestedEroticProfile: string;
  reasoning: string;
}

type CharacterWithTags = {
  id: string;
  name: string;
  tags?: string[] | null;
};

type ConversationEntry = {
  id: string;
};

/**
 * Analyzes play history to infer user preferences.
 * Returns a recommendation hint string to prepend to the LLM generation prompt.
 */
export const buildRecommendationPrompt = (
  topCharacters: CharacterWithTags[],
  playHistory: ConversationEntry[],
): string => {
  const tagFreq = new Map<string, number>();
  for (const char of topCharacters) {
    for (const tag of char.tags ?? []) {
      tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return `Based on play history of ${playHistory.length} conversations, the user tends to enjoy characters with these traits: ${topTags.join(", ")}. Create a NEW character that fits these preferences but is distinct from existing ones. Output JSON matching: { name, personality, scenario, greeting, tags, eroticProfile }.`;
};
