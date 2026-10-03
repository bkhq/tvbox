import type { Upstream } from "./-tvbox-api";
import { useTranslation } from "react-i18next";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { upstreamTree } from "./-tvbox-view";

export interface UpstreamChoice {
  readonly allUpstreams: boolean;
  readonly upstreamIds: ReadonlySet<string>;
}

/** Every upstream, or a chosen few; the common entries always come along. */
export function UpstreamPicker({
  value,
  upstreams,
  onChange,
}: {
  readonly value: UpstreamChoice;
  readonly upstreams: readonly Upstream[];
  readonly onChange: (value: UpstreamChoice) => void;
}) {
  const { t } = useTranslation("devices");
  const pick = (id: string) => {
    const next = new Set(value.upstreamIds);
    if (!next.delete(id))
      next.add(id);
    onChange({ ...value, upstreamIds: next });
  };

  return (
    <div className="space-y-2">
      <Label>{t("content")}</Label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={value.allUpstreams} onCheckedChange={allUpstreams => onChange({ ...value, allUpstreams })} />
        {t("followAll")}
      </label>
      {!value.allUpstreams && (
        <div className="space-y-1 rounded-md border p-2">
          {upstreams.length === 0 && <p className="text-xs text-muted-foreground">{t("noUpstreams")}</p>}
          {upstreamTree(upstreams).map(({ upstream: u, depth, lines }) => {
            // A picked collection already brings every line.
            const covered = u.parentId !== null && value.upstreamIds.has(u.parentId);
            return (
              <label key={u.id} className={depth === 1 ? "flex items-center gap-2 pl-6 text-sm" : "flex items-center gap-2 text-sm"}>
                <input type="checkbox" checked={covered || value.upstreamIds.has(u.id)} disabled={covered} onChange={() => pick(u.id)} className="size-4 accent-primary" />
                {u.name}
                <span className="text-xs text-muted-foreground">
                  {lines > 0 ? t("lineCount", { count: lines }) : t("entryCount", { count: u.entryCount })}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("commonHint")}</p>
    </div>
  );
}
