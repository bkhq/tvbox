import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Textarea } from "@/shared/components/ui/textarea";

/**
 * Edit one JSON value as text. `objectOnly` refuses anything but an object,
 * which is what every list entry is. A read-only dialog has no save button.
 */
export function JsonDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly value: unknown;
  readonly onSave?: (value: unknown) => void;
  readonly objectOnly?: boolean;
  readonly pending?: boolean;
  readonly extra?: ReactNode;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {/* Remounted on every open so the text starts from the current value. */}
        {props.open && <JsonEditor {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function JsonEditor({
  title,
  value,
  onSave,
  objectOnly = false,
  pending = false,
  extra,
}: {
  readonly title: ReactNode;
  readonly value: unknown;
  readonly onSave?: ((value: unknown) => void) | undefined;
  readonly objectOnly?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly extra?: ReactNode;
}) {
  const { t } = useTranslation(["common", "tvbox"]);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2) ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    }
    catch (err) {
      setError(err instanceof Error ? err.message : t("tvbox:json.invalid"));
      return;
    }
    if (objectOnly && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))) {
      setError(t("tvbox:json.objectRequired"));
      return;
    }
    onSave?.(parsed);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {extra}
      {error && <ErrorBanner message={error} />}
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        readOnly={!onSave}
        spellCheck={false}
        className="h-[60vh] font-mono text-xs"
      />
      <DialogFooter>
        <DialogClose render={<Button variant="outline">{onSave ? t("common.cancel") : t("tvbox:json.close")}</Button>} />
        {onSave && (
          <Button onClick={save} disabled={pending}>
            {t("tvbox:json.save")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
