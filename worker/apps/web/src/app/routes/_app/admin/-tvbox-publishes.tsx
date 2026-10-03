import type { JsonObject } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, RotateCcw, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { errorMessage, tvboxApi, tvboxKeys } from "./-tvbox-api";
import { JsonDialog } from "./-tvbox-json-dialog";
import { countsText } from "./-tvbox-view";

export function PublishesTab() {
  const { t } = useTranslation(["common", "tvbox"]);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: tvboxKeys.publishes, queryFn: tvboxApi.publishes });
  const [preview, setPreview] = useState<JsonObject | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: tvboxKeys.publishes });
  const onError = (err: unknown) => toast.error(errorMessage(err, t("common.error.operationFailed")));

  const loadPreview = useMutation({ mutationFn: tvboxApi.preview, onSuccess: setPreview, onError });
  const publish = useMutation({
    mutationFn: tvboxApi.publish,
    onSuccess: () => {
      toast.success(t("tvbox:publishes.published"));
      refresh();
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: (id: string) => tvboxApi.restore(id),
    onSuccess: () => {
      toast.success(t("tvbox:publishes.restored"));
      refresh();
    },
    onError,
  });

  const latest = query.data?.[0]?.id;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("tvbox:publishes.description")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={loadPreview.isPending} onClick={() => loadPreview.mutate()}>
            <Eye className="size-4" />
            {t("tvbox:publishes.preview")}
          </Button>
          <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
            <Send className="size-4" />
            {t("tvbox:publishes.publish")}
          </Button>
        </div>
      </div>

      {query.error && <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />}
      {query.isLoading && <CenteredHint>{t("common.loading")}</CenteredHint>}
      {query.data?.length === 0 && <CenteredHint>{t("tvbox:publishes.empty")}</CenteredHint>}

      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tvbox:publishes.time")}</TableHead>
              <TableHead>{t("tvbox:publishes.trigger")}</TableHead>
              <TableHead>{t("tvbox:publishes.contents")}</TableHead>
              <TableHead className="text-right">{t("tvbox:actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map(p => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  {new Date(p.createdAt).toLocaleString()}
                  {p.id === latest && <Badge className="ml-2">{t("tvbox:publishes.live")}</Badge>}
                </TableCell>
                <TableCell>{t(`tvbox:publishes.triggers.${p.trigger}`)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{countsText(p.counts)}</TableCell>
                <TableCell className="text-right">
                  {p.id !== latest && (
                    <Button size="sm" variant="ghost" disabled={restore.isPending} onClick={() => restore.mutate(p.id)}>
                      <RotateCcw className="size-4" />
                      {t("tvbox:publishes.restore")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <JsonDialog
        open={preview !== null}
        onOpenChange={open => !open && setPreview(null)}
        title={t("tvbox:publishes.preview")}
        value={preview}
      />
    </div>
  );
}
