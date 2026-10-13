import type { Person, Title } from "./-media-api";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import { Input } from "@/shared/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { mediaApi, mediaKeys, orNull } from "./-media-api";
import { useMediaMutation } from "./-media-hooks";
import { EnumSelect, Field } from "./-media-shared";

const ALL_SEASONS = "all";
const JOBS = ["Director", "Writer", "Screenplay", "Creator", "Producer"] as const;

export function CreditsPanel({ title }: { title: Title }) {
  const { t } = useTranslation(["common", "media"]);
  const credits = useQuery({ queryKey: mediaKeys.credits(title.id), queryFn: () => mediaApi.credits(title.id) });
  const seasons = useQuery({ queryKey: mediaKeys.seasons(title.id), queryFn: () => mediaApi.seasons(title.id), enabled: title.kind === "series" });
  const [q, setQ] = useState("");
  const people = useQuery({ queryKey: mediaKeys.people(q, 1), queryFn: () => mediaApi.people(q, 1), enabled: q.trim() !== "" });
  const [person, setPerson] = useState<Person | null>(null);
  const [role, setRole] = useState<"cast" | "crew">("cast");
  const [character, setCharacter] = useState("");
  const [job, setJob] = useState<typeof JOBS[number]>("Director");
  const [season, setSeason] = useState(ALL_SEASONS);

  const add = useMediaMutation(() => mediaApi.addCredit(title.id, {
    personId: person!.id,
    role,
    seasonId: season === ALL_SEASONS ? null : Number(season),
    ...(role === "cast" ? { character: orNull(character) } : { job, character: null }),
  }), () => {
    setPerson(null);
    setCharacter("");
    setQ("");
  });
  const createPerson = useMediaMutation(() => mediaApi.createPerson({ name: q.trim() }), p => setPerson(p));
  const remove = useMediaMutation((id: string) => mediaApi.deleteCredit(id));
  const seasonName = (id: number | null) => {
    if (id === null)
      return t("media:credits.allSeasons");
    const s = seasons.data?.find(x => x.id === id);
    return s ? s.name ?? t("media:seasons.numbered", { number: s.seasonNumber }) : `#${id}`;
  };

  return (
    <div className="space-y-4 pt-4">
      {credits.data?.length === 0 && <CenteredHint>{t("media:credits.empty")}</CenteredHint>}
      {credits.data && credits.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("media:credits.person")}</TableHead>
              <TableHead>{t("media:credits.role")}</TableHead>
              <TableHead>{t("media:credits.as")}</TableHead>
              {title.kind === "series" && <TableHead>{t("media:credits.season")}</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {credits.data.map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.personName}</TableCell>
                <TableCell><Badge variant="outline">{t(`media:credits.roles.${c.role}`)}</Badge></TableCell>
                <TableCell>{c.role === "cast" ? c.character : c.job}</TableCell>
                {title.kind === "series" && <TableCell>{seasonName(c.seasonId)}</TableCell>}
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="space-y-3 rounded-md border p-3">
        <Field label={t("media:credits.person")}>
          {person
            ? (
                <div className="flex items-center gap-2">
                  <Badge>{person.name}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>{t("media:credits.change")}</Button>
                </div>
              )
            : (
                <div className="space-y-1">
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t("media:credits.searchPerson")} />
                  <div className="flex flex-wrap gap-1">
                    {people.data?.items.map(p => (
                      <Badge key={p.id} variant="outline" className="cursor-pointer" onClick={() => setPerson(p)}>{p.name}</Badge>
                    ))}
                    {q.trim() && people.data?.items.every(p => p.name !== q.trim()) && (
                      <Badge variant="secondary" className="cursor-pointer" onClick={() => createPerson.mutate(undefined)}>
                        {t("media:credits.newPerson", { name: q.trim() })}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("media:credits.role")}>
            <EnumSelect value={role} values={["cast", "crew"] as const} label={v => t(`media:credits.roles.${v}`)} onChange={setRole} />
          </Field>
          {role === "cast"
            ? <Field label={t("media:credits.character")}><Input value={character} onChange={e => setCharacter(e.target.value)} /></Field>
            : (
                <Field label={t("media:credits.job")}>
                  <EnumSelect value={job} values={JOBS} label={v => t(`media:credits.jobs.${v}`)} onChange={setJob} />
                </Field>
              )}
          {title.kind === "series" && (
            <Field label={t("media:credits.season")}>
              <EnumSelect
                value={season}
                values={[ALL_SEASONS, ...(seasons.data ?? []).map(s => String(s.id))]}
                label={v => seasonName(v === ALL_SEASONS ? null : Number(v))}
                onChange={setSeason}
              />
            </Field>
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!person || add.isPending} onClick={() => add.mutate(undefined)}>{t("media:credits.add")}</Button>
        </div>
      </div>
    </div>
  );
}
