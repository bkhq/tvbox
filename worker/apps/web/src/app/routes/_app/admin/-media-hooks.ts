import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mediaKeys } from "./-media-api";

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error
    ? err.message
    : fallback;
}

/**
 * A mutation that refreshes every media query and toasts its error. Every
 * change can show up in several lists (a season's count on the title, a
 * title in a row), so the whole module is refetched.
 */
export function useMediaMutation<V, R>(fn: (vars: V) => Promise<R>, onDone?: (result: R) => void) {
  const qc = useQueryClient();
  const { t } = useTranslation("common");
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: mediaKeys.all });
      onDone?.(result);
    },
    onError: err => toast.error(errorText(err, t("common.error.operationFailed"))),
  });
}
