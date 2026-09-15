import { type ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/component/ui/sheet";
import { cn } from "@/lib/utils";

type BegSheetProps = {
  open: boolean;
  title?: string;
  description?: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
};

const dragHandleClass =
  "mx-auto h-1.5 w-12 rounded-full bg-[var(--ghost)] shadow-[var(--read-shadow-soft)]";

export const BegSheet = ({
  open,
  title = "ねだる",
  description = "ことばにする前の、ちいさなお願い。",
  children,
  onOpenChange,
}: BegSheetProps): React.JSX.Element => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="bottom"
      className={cn(
        "max-h-[82dvh] rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)]/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 text-[var(--text)] shadow-[0_-24px_64px_rgba(5,3,2,.62)] backdrop-blur-[24px]",
        "data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full",
      )}
    >
      <div className={dragHandleClass} aria-hidden="true" />
      <SheetHeader className="px-0 pb-1 pt-4 text-left">
        <SheetTitle className="font-narrative text-[20px] font-medium tracking-[0.18em] text-[var(--text)] [text-shadow:var(--read-shadow)]">
          {title}
        </SheetTitle>
        <SheetDescription className="font-round text-[12px] leading-6 tracking-[0.06em] text-[var(--dim)] [text-shadow:var(--read-shadow-soft)]">
          {description}
        </SheetDescription>
      </SheetHeader>
      <div className="overflow-y-auto pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </SheetContent>
  </Sheet>
);
