import type { TitleKind } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { mediaApi, mediaKeys } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { MoveButtons, NameInput } from "./-media-shared";

const KINDS: readonly TitleKind[] = ["movie", "series"];

export function TaxonomyTab() {
  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-2">
      <Categories />
      <div className="space-y-8">
        <Genres />
        <Collections />
      </div>
    </div>
  );
}

function Categories() {
  const { t } = useTranslation(["common", "media"]);
  const categories = useQuery({ queryKey: mediaKeys.categories, queryFn: mediaApi.categories });
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const add = useMediaMutation(() => mediaApi.createCategory({ id: id.trim(), name: name.trim(), kinds: ["movie", "series"] }), () => {
    setId("");
    setName("");
  });
  const update = useMediaMutation(({ id, body }: { id: string; body: { name?: string; kinds?: TitleKind[] } }) => mediaApi.updateCategory(id, body));
  const remove = useMediaMutation((id: string) => mediaApi.deleteCategory(id));
  const reorder = useMediaMutation((ids: string[]) => mediaApi.reorderCategories(ids));
  const ids = categories.data?.map(c => c.id) ?? [];

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t("media:taxonomy.categories")}</h3>
      <p className="text-xs text-muted-foreground">{t("media:taxonomy.categoriesHint")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>{t("media:taxonomy.name")}</TableHead>
            <TableHead>{t("media:taxonomy.kinds")}</TableHead>
            <TableHead>{t("media:taxonomy.titles")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.data?.map((c, i) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">{c.id}</TableCell>
              <TableCell><NameInput key={c.name} value={c.name} onSave={name => update.mutate({ id: c.id, body: { name } })} /></TableCell>
              <TableCell className="space-x-1">
                {KINDS.map((k) => {
                  const on = c.kinds.includes(k);
                  return (
                    <Badge
                      key={k}
                      variant={on ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        const kinds = on ? c.kinds.filter(x => x !== k) : [...c.kinds, k];
                        if (kinds.length > 0)
                          update.mutate({ id: c.id, body: { kinds } });
                      }}
                    >
                      {t(`media:kind.${k}`)}
                    </Badge>
                  );
                })}
              </TableCell>
              <TableCell>{c.titleCount}</TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <MoveButtons ids={ids} index={i} onMove={next => reorder.mutate(next)} />
                <Button size="sm" variant="ghost" disabled={c.titleCount > 0} onClick={() => remove.mutate(c.id)}><Trash2 className="size-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2">
        <Input className="w-32" value={id} onChange={e => setId(e.target.value)} placeholder="sports" />
        <Input className="w-40" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:taxonomy.name")} />
        <Button size="sm" variant="outline" disabled={!id.trim() || !name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
      </div>
    </section>
  );
}

function Genres() {
  const { t } = useTranslation(["common", "media"]);
  const genres = useQuery({ queryKey: mediaKeys.genres, queryFn: mediaApi.genres });
  const [name, setName] = useState("");
  const add = useMediaMutation(() => mediaApi.createGenre(name.trim()), () => setName(""));
  const rename = useMediaMutation(({ id, name }: { id: string; name: string }) => mediaApi.updateGenre(id, name));
  const remove = useMediaMutation((id: string) => mediaApi.deleteGenre(id));

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t("media:taxonomy.genres")}</h3>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {genres.data?.map(g => (
          <div key={g.id} className="flex items-center gap-1">
            <NameInput key={g.name} value={g.name} onSave={name => rename.mutate({ id: g.id, name })} />
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(g.id)}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input className="w-40" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:taxonomy.name")} />
        <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
      </div>
    </section>
  );
}

function Collections() {
  const { t } = useTranslation(["common", "media"]);
  const collections = useQuery({ queryKey: mediaKeys.collections, queryFn: mediaApi.collections });
  const [name, setName] = useState("");
  const add = useMediaMutation(() => mediaApi.createCollection({ name: name.trim() }), () => setName(""));
  const rename = useMediaMutation(({ id, name }: { id: string; name: string }) => mediaApi.updateCollection(id, { name }));
  const remove = useMediaMutation((id: string) => mediaApi.deleteCollection(id));

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t("media:taxonomy.collections")}</h3>
      <p className="text-xs text-muted-foreground">{t("media:taxonomy.collectionsHint")}</p>
      {collections.data?.map(c => (
        <div key={c.id} className="flex items-center gap-2">
          <NameInput key={c.name} value={c.name} onSave={name => rename.mutate({ id: c.id, name })} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">{t("media:taxonomy.titleCount", { count: c.titleCount })}</span>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input className="w-40" value={name} onChange={e => setName(e.target.value)} placeholder={t("media:taxonomy.name")} />
        <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:add")}</Button>
      </div>
    </section>
  );
}
