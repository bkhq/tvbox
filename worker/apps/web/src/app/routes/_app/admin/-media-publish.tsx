import type { JsonObject, ListKind } from "./-tvbox-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { errorText } from "./-media-hooks";
import { tvboxApi, tvboxKeys } from "./-tvbox-api";

// What the subscription carries for the library; `@media/` becomes each
// device's own `<origin>/s/<token>/media/` when it is served.
const ENTRIES: { kind: ListKind; key: string; data: JsonObject }[] = [
  {
    kind: "sites",
    key: "site",
    data: { key: "own_media", name: "媒体库", type: 1, api: "@media/cms", searchable: 1, quickSearch: 1, filterable: 1, mediaApi: "@media/v1" },
  },
  {
    kind: "lives",
    key: "live",
    data: { name: "自有直播", type: 0, url: "@media/live.m3u", mediaApi: "@media/v1" },
  },
];

export function PublishTab() {
  const { t } = useTranslation(["common", "media"]);
  const qc = useQueryClient();
  const sites = useQuery({ queryKey: tvboxKeys.entries("sites", "common", false), queryFn: () => tvboxApi.entries("sites", "common") });
  const lives = useQuery({ queryKey: tvboxKeys.entries("lives", "common", false), queryFn: () => tvboxApi.entries("lives", "common") });
  const present = (kind: ListKind) => (kind === "sites" ? sites.data : lives.data)?.some(e => JSON.stringify(e.data).includes("\"@media/")) ?? false;

  const add = useMutation({
    mutationFn: (entry: typeof ENTRIES[number]) => tvboxApi.createEntry(entry.kind, entry.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tvbox"] }),
    onError: err => toast.error(errorText(err, t("common.error.operationFailed"))),
  });
  const publish = useMutation({
    mutationFn: () => tvboxApi.publish(),
    onSuccess: () => {
      toast.success(t("media:publish.published"));
      void qc.invalidateQueries({ queryKey: ["tvbox"] });
    },
    onError: err => toast.error(errorText(err, t("common.error.operationFailed"))),
  });

  return (
    <div className="max-w-3xl space-y-8 pt-4">
      <section className="space-y-2">
        <h3 className="font-medium">{t("media:publish.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("media:publish.description")}</p>
        <div className="flex gap-2">
          <Button disabled={publish.isPending} onClick={() => publish.mutate()}>{t("media:publish.publish")}</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">{t("media:publish.entries")}</h3>
        <p className="text-sm text-muted-foreground">{t("media:publish.entriesHint")}</p>
        {ENTRIES.map(entry => (
          <div key={entry.key} className="flex items-center gap-3 rounded-md border p-3">
            <div className="flex-1">
              <div className="font-medium">{t(`media:publish.entry.${entry.key}`)}</div>
              <code className="text-xs break-all text-muted-foreground">{JSON.stringify(entry.data)}</code>
            </div>
            {present(entry.kind)
              ? (
                  <Badge variant="secondary">
                    <Check className="size-3" />
                    {t("media:publish.added")}
                  </Badge>
                )
              : <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate(entry)}>{t("media:add")}</Button>}
          </div>
        ))}
      </section>
    </div>
  );
}
