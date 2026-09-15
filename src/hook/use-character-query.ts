import { useCallback } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createCharacter,
  deleteCharacter,
  listCharacters,
  shouldRetryCharacterList,
  updateCharacter,
  type Character,
  type CharacterInput,
} from "@/lib/api";
import { queryKey } from "@/lib/query-key";

const mergeCharacterUpdate = (
  prev: Character,
  input: CharacterInput,
  updates: Partial<Character>,
): Character => {
  const next: Character = { ...prev };
  next.name = input.name;
  next.avatar = input.avatar ?? next.avatar;
  next.gender = input.gender ?? next.gender;
  next.systemPrompt = input.systemPrompt;
  next.greeting = input.greeting;
  next.tags = input.tags;
  if (input.userPersona !== undefined) {
    next.userPersonaName = input.userPersona.name ?? next.userPersonaName;
    next.userPersonaGender = input.userPersona.gender ?? next.userPersonaGender;
    next.userPersonaPersonality = input.userPersona.personality ?? next.userPersonaPersonality;
  }
  Object.assign(next, updates);
  return next;
};

export const useCharacterQuery = () => {
  const queryClient = useQueryClient();

  const {
    data: characters = [],
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKey.characterList,
    queryFn: listCharacters,
    retry: shouldRetryCharacterList,
  });

  const createCharacterMutation = useMutation({
    mutationFn: createCharacter,
    onSuccess: (character) => {
      queryClient.setQueryData<Character[]>(queryKey.characterList, (previous) =>
        previous ? [character, ...previous] : [character],
      );
    },
  });

  const updateCharacterMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CharacterInput }) =>
      updateCharacter(id, input),
    // #1224/#1228: userPersonaNameはサーバ側で正規化されうるため、クライアント入力を
    // そのままキャッシュへ書くと表示値とD1の実値が乖離する。サーバが返した正規化後の
    // 値（updates）を優先し、無ければ入力値にフォールバックする
    // （敵対レビュー #1236 指摘・6巡目）。
    onSuccess: (updates, { id, input }) => {
      queryClient.setQueryData<Character[]>(queryKey.characterList, (previous) =>
        previous
          ? previous.map((c) => (c.id === id ? mergeCharacterUpdate(c, input, updates) : c))
          : [],
      );
    },
  });

  const deleteCharacterMutation = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: (_, id) => {
      queryClient.setQueryData<Character[]>(queryKey.characterList, (previous) =>
        previous ? previous.filter((c) => c.id !== id) : [],
      );
    },
  });

  const createCharacterEntry = useCallback(
    async (input: CharacterInput) => createCharacterMutation.mutateAsync(input),
    [createCharacterMutation],
  );

  const updateCharacterEntry = useCallback(
    async (id: string, input: CharacterInput) => updateCharacterMutation.mutateAsync({ id, input }),
    [updateCharacterMutation],
  );

  const deleteCharacterEntry = useCallback(
    async (id: string) => deleteCharacterMutation.mutateAsync(id),
    [deleteCharacterMutation],
  );

  return {
    characters,
    isLoading: isPending || isFetching,
    error,
    refetch,
    createCharacterEntry,
    updateCharacterEntry,
    deleteCharacterEntry,
  };
};
