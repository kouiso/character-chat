import { CreateFlow } from "@/component/character/ou-create-flow";
import { useCharacterQuery } from "@/hook/use-character-query";
import type { CharacterInput } from "@/lib/api";
import type { GeneratedCharacter } from "@/lib/character-generator";
import { deriveVisualMetaFromText } from "@/lib/character-visual-meta";
import { buildSystemPrompt } from "@/lib/prompt-builder";

interface OuCreateFlowEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (characterId: string) => void;
  // 素材管理で選んだ画像。作成フローのアップロード欄へ引き継ぐ（#823）
  initialUploadedImage?: string | null;
}

const generateImageSeed = (): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % 2_147_483_647;
};

const deriveVisualPrompt = (name: string, tags: string[]): string => {
  const parts = [name.trim(), ...tags.map((t) => t.trim()).filter(Boolean)];
  return parts.filter(Boolean).join(", ");
};

const generatedToInput = (generated: GeneratedCharacter): CharacterInput => {
  const systemPrompt = buildSystemPrompt({
    name: generated.name,
    personality: generated.personality,
    scenario: generated.scenario,
    eroticProfile: generated.eroticProfile,
    custom: "",
  });
  return {
    name: generated.name,
    avatar: generated.avatar,
    gender: generated.characterGender,
    systemPrompt,
    greeting: generated.greeting,
    tags: generated.tags,
    userPersona: {
      name: null,
      gender: generated.targetUserGender === "any" ? null : generated.targetUserGender,
      personality: null,
    },
    seed: generateImageSeed(),
    visualPrompt: deriveVisualPrompt(generated.name, generated.tags),
    // #597: 生成文に髪色の根拠がある時だけ外見を保存する。無ければ行を作らない。
    visualMeta: deriveVisualMetaFromText(`${systemPrompt} ${generated.tags.join(" ")}`),
  };
};

export const OuCreateFlowEntry = ({
  open,
  onOpenChange,
  onCreated,
  initialUploadedImage,
}: OuCreateFlowEntryProps) => {
  const { createCharacterEntry } = useCharacterQuery();

  const handleSave = (generated: GeneratedCharacter) => {
    void (async () => {
      const created = await createCharacterEntry(generatedToInput(generated));
      onOpenChange(false);
      onCreated?.(created.id);
    })();
  };

  return (
    <CreateFlow
      open={open}
      onOpenChange={onOpenChange}
      onSaveDirectly={handleSave}
      onEditAndSave={handleSave}
      initialUploadedImage={initialUploadedImage}
    />
  );
};
