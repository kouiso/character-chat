"use client";

import * as React from "react";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/component/ui/button";
import { cn } from "@/lib/utils";

const Dialog = ({ ...props }: DialogPrimitive.Root.Props): React.JSX.Element => (
  <DialogPrimitive.Root data-slot="dialog" {...props} />
);

const DialogTrigger = ({ ...props }: DialogPrimitive.Trigger.Props): React.JSX.Element => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

const DialogPortal = ({ ...props }: DialogPrimitive.Portal.Props): React.JSX.Element => (
  <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
);

const DialogClose = ({ ...props }: DialogPrimitive.Close.Props): React.JSX.Element => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} />
);

const DialogOverlay = ({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): React.JSX.Element => (
  <DialogPrimitive.Backdrop
    data-slot="dialog-overlay"
    className={cn(
      "fixed inset-0 isolate z-50 bg-[radial-gradient(circle_at_50%_30%,rgba(214,169,87,.14),rgba(10,7,6,.96)_60%)] duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
      className,
    )}
    {...props}
  />
);

const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}): React.JSX.Element => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Popup
      data-slot="dialog-content"
      className={cn(
        "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[24px] border border-[var(--hairline)] bg-[var(--night)]/95 p-4 font-round text-sm text-[var(--text)] shadow-[0_24px_72px_rgba(5,3,2,.68)] ring-1 ring-[var(--hairline)] duration-150 outline-none backdrop-blur-[24px] sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2 text-[var(--ghost)] hover:bg-[var(--lamp-7)] hover:text-[var(--lamp)]"
              size="icon-sm"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Popup>
  </DialogPortal>
);

const DialogHeader = ({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element => (
  <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
);

const DialogFooter = ({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}): React.JSX.Element => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  >
    {children}
    {showCloseButton && (
      <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
    )}
  </div>
);

const DialogTitle = ({ className, ...props }: DialogPrimitive.Title.Props): React.JSX.Element => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn(
      "font-narrative text-base font-medium leading-none tracking-[0.12em] text-[var(--text)] [text-shadow:var(--read-shadow-soft)]",
      className,
    )}
    {...props}
  />
);

const DialogDescription = ({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.JSX.Element => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn(
      "font-round text-sm leading-6 text-[var(--dim)] *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
      className,
    )}
    {...props}
  />
);

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
