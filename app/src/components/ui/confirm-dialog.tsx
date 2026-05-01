import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  /** Controls open/closed state. */
  open: boolean;
  /** Called when the dialog requests to close (user pressed Escape, clicked
   *  outside, or confirmed/cancelled). Parent should clear its open state. */
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Label for the confirming action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** If true, the confirm button uses destructive styling (red) to flag an
   *  irreversible action. */
  destructive?: boolean;
  /** Called when the user confirms. If it returns a promise the button is
   *  disabled until it resolves. */
  onConfirm: () => void | Promise<void>;
}

/**
 * Reusable destructive-action confirmation dialog built on the shadcn/radix
 * Dialog primitives. Use in place of `window.confirm()` / `window.alert()`
 * so the experience is themed, focus-trapped, keyboard-driven, and
 * non-blocking for screen readers.
 *
 * Keyboard behavior (inherited from Radix Dialog):
 *   Escape   → cancel
 *   Tab      → cycles between Cancel and Confirm; focus is trapped
 *   Enter    → submits whichever button is focused (focus starts on Cancel
 *              for destructive dialogs as a guard rail)
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // ignore close while an async confirm is in flight
        onOpenChange(next);
      }}
    >
      <DialogContent
        // Auto-focus the cancel button when the dialog opens. The user has
        // to explicitly Tab to the destructive action before they can hit
        // Enter, which makes accidental confirmation much harder than a
        // native window.confirm.
        onOpenAutoFocus={(e) => {
          if (destructive) {
            e.preventDefault();
            cancelRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
