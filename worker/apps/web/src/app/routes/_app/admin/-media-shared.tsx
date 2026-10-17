import type { ReactNode } from "react";
import type { PublishState, Title } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { mediaApi, mediaKeys } from "./-media-api";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `space-y-1 ${className}` : "space-y-1"}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function StateBadge({ state }: { state: PublishState }) {
  const { t } = useTranslation("media");
  return <Badge variant={state === "published" ? "default" : state === "hidden" ? "outline" : "secondary"}>{t(`state.${state}`)}</Badge>;
}

/** A select over fixed values, labelled by `label`. */
export function EnumSelect<T extends string>({ value, values, label, onChange, className }: {
  value: T;
  values: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={v => v !== null && onChange(v as T)}>
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue>{(v: string) => label(v as T)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {values.map(v => <SelectItem key={v} value={v}>{label(v)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Up/down buttons that move `ids[index]` and hand the new order on. */
export function MoveButtons({ ids, index, onMove }: { ids: readonly string[]; index: number; onMove: (ids: string[]) => void }) {
  const move = (delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onMove(next);
  };
  return (
    <>
      <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button>
      <Button size="sm" variant="ghost" disabled={index === ids.length - 1} onClick={() => move(1)}><ArrowDown className="size-4" /></Button>
    </>
  );
}

/** An ordered list of titles: search to add, remove, reorder. */
export function TitleListEditor({ ids, onChange, max }: { ids: string[]; onChange: (ids: string[]) => void; max: number }) {
  const { t } = useTranslation("media");
  const [q, setQ] = useState("");
  const search = useQuery({
    queryKey: mediaKeys.titles({ q, limit: 8 }),
    queryFn: () => mediaApi.titles({ q: q.trim() || undefined, limit: 8 }),
    enabled: q.trim() !== "",
  });
  const known = useQuery({
    queryKey: mediaKeys.titles({ ids: ids.join(","), limit: 100 }),
    queryFn: async () => (await Promise.all(ids.map(id => mediaApi.title(id).catch(() => null)))).filter((x): x is Title => x !== null),
    enabled: ids.length > 0,
  });
  const name = (id: string) => known.data?.find(x => x.id === id)?.title ?? `#${id}`;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {ids.map((id, i) => (
          <div key={id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
            <span className="flex-1 truncate">{name(id)}</span>
            <MoveButtons ids={ids} index={i} onMove={onChange} />
            <Button size="sm" variant="ghost" onClick={() => onChange(ids.filter(x => x !== id))}><X className="size-4" /></Button>
          </div>
        ))}
        {ids.length === 0 && <p className="text-sm text-muted-foreground">{t("picker.empty")}</p>}
      </div>
      {ids.length < max && (
        <div className="space-y-1">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t("picker.search")} />
          {search.data?.items.filter(x => !ids.includes(x.id)).map(x => (
            <button
              key={x.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => onChange([...ids, x.id])}
            >
              <Plus className="size-4" />
              <span className="flex-1 truncate">{x.title}</span>
              <StateBadge state={x.publishState} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A name edited in place: saved when it loses focus. */
export function NameInput({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  return (
    <Input
      className="h-7"
      defaultValue={value}
      onBlur={e => e.target.value.trim() && e.target.value.trim() !== value && onSave(e.target.value.trim())}
      onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
