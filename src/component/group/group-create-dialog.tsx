import { useMemo, useState, type FormEvent, type JSX } from "react";

import { Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/component/ui/avatar";
import { Button } from "@/component/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";
import { createGroup, type ChatGroup } from "@/lib/api";
import { resolveAvatarSrc } from "@/lib/avatar-url";
import { createLogger } from "@/lib/logger";
import { cn, getAvatarFallback } from "@/lib/utils";

const logger = createLogger("group-create-dialog");

const fieldClassName =
  "rounded-[14px] border border-[var(--hairline)] bg-[var(--veil)] px-3 font-round text-[13.5px] leading-6 tracking-[0.04em] text-[var(--text)] outline-none placeholder:text-[var(--ghost)] focus-visible:border-[var(--lamp-45)] focus-visible:ring-2 focus-visible:ring-[var(--lamp-10)]";
const labelClassName = "grid gap-1.5 font-mono text-[9px] tracking-[0.28em] text-[var(--ghost)]";

const isAvatarImage = (avatar: string | null): avatar is string =>
  resolveAvatarSrc(avatar) !== null;

export type GroupCreateCharacter = {
  id: string;
  name: string;
  avatar: string | null;
};

type GroupCreateDialogProps = {
  open: boolean;
  characters: GroupCreateCharacter[];
  onOpenChange: (open: boolean) => void;
  onCreated: (group: ChatGroup) => void;
};

export const GroupCreateDialog = ({
  open,
  characters,
  onOpenChange,
  onCreated,
}: GroupCreateDialogProps): JSX.Element => {
  const [name, setName] = useState("");
  const [scenario, setScenario] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSaving, setSaving] = useState(false);
  const canSubmit = name.trim().length > 0 && selectedIds.length >= 2 && selectedIds.length <= 4;
  const selectedNames = useMemo(
    () =>
      characters
        .filter((character) => selectedIds.includes(character.id))
        .map((character) => character.name)
        .join("、"),
    [characters, selectedIds],
  );

  const toggleCharacter = (characterId: string): void => {
    setSelectedIds((current) => {
      if (current.includes(characterId)) {
        return current.filter((id) => id !== characterId);
      }
      if (current.length >= 4) {
        toast.info("グループは最大4人までです");
        return current;
      }
      return [...current, characterId];
    });
  };

  const reset = (): void => {
    setName("");
    setScenario("");
    setSelectedIds([]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    try {
      const group = await createGroup({
        name: name.trim(),
        characterIds: selectedIds,
        scenario: scenario.trim() || undefined,
      });
      toast.success("グループを作成しました");
      onCreated(group);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error("グループ作成に失敗しました");
      logger.error("Group creation failed", { error });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--hairline)] bg-[var(--night)]/95 p-5 shadow-[0_24px_72px_rgba(5,3,2,.68)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-narrative text-[20px] tracking-[0.18em] text-[var(--text)] [text-shadow:var(--read-shadow)]">
            新グループ作成
          </DialogTitle>
          <DialogDescription className="font-round text-[12px] leading-6 tracking-[0.06em] text-[var(--dim)]">
            2〜4人のキャラクターを選んで会話を始めます。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-5"
        >
          <label className={labelClassName}>
            グループ名
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              className={cn(fieldClassName, "h-11")}
              placeholder={selectedNames ? `${selectedNames}の部屋` : "放課後の部屋"}
            />
          </label>
          <label className={labelClassName}>
            シナリオ
            <textarea
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              maxLength={2000}
              className={cn(fieldClassName, "min-h-28 resize-y py-2.5")}
              placeholder="場所、関係性、始まりの状況"
            />
            <span className="font-round text-[11px] tracking-normal text-[var(--ghost)]">
              {scenario.length}/2000
            </span>
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.28em] text-[var(--ghost)]">
              <span>参加キャラ</span>
              <span>{selectedIds.length}/4</span>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {characters.map((character) => {
                const selected = selectedIds.includes(character.id);
                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() => toggleCharacter(character.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[16px] border p-3 text-left font-round transition-colors",
                      selected
                        ? "border-[var(--lamp-55)] bg-[var(--lamp-10)] shadow-[0_0_18px_var(--lamp-14)]"
                        : "border-[var(--hairline)] bg-[var(--veil)] hover:bg-[var(--lamp-7)]",
                    )}
                  >
                    <Avatar>
                      {isAvatarImage(character.avatar) ? (
                        <AvatarImage
                          src={resolveAvatarSrc(character.avatar) ?? ""}
                          alt={character.name}
                        />
                      ) : null}
                      <AvatarFallback>{getAvatarFallback(character.name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-[13px] tracking-[0.06em] text-[var(--text)]">
                      {character.name}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border font-mono text-xs",
                        selected
                          ? "border-[var(--lamp)] bg-[var(--lamp)] text-[var(--night)]"
                          : "border-[var(--hairline)] text-[var(--ghost)]",
                      )}
                    >
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className="border-[var(--hairline)] bg-[var(--night)]/65">
            <Button
              type="submit"
              disabled={!canSubmit || isSaving}
              className="rounded-full bg-[var(--lamp)] px-5 font-narrative text-[14px] font-semibold tracking-[0.18em] text-[var(--night)] shadow-[0_14px_34px_-12px_var(--lamp-55)] hover:bg-[var(--lamp)]/90"
            >
              {isSaving ? <Loader2 className="animate-spin" /> : <MessagesSquare />}
              作成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
