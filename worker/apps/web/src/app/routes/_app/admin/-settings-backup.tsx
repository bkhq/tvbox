import { Download, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { APP_NAME } from "@/shared/lib/branding";
import { http, httpRaw } from "@/shared/lib/http";
import { ErrorBanner } from "./-settings-shared";

const RE_FILENAME = /filename="(.+?)"/;

interface BackupModuleInfo {
  readonly name: string;
  readonly deps: readonly string[];
}

function resolveModuleDeps(selected: Set<string>, modules: readonly BackupModuleInfo[]): Set<string> {
  const byName = new Map(modules.map(m => [m.name, m.deps]));
  const resolved = new Set(selected);
  for (const mod of selected) {
    for (const dep of byName.get(mod) ?? []) {
      resolved.add(dep);
    }
  }
  return resolved;
}

function getRequiredByDeps(mod: string, selected: Set<string>, modules: readonly BackupModuleInfo[]): string[] {
  const byName = new Map(modules.map(m => [m.name, m.deps]));
  return [...selected].filter(m => byName.get(m)?.includes(mod) ?? false);
}

export function BackupSettingsTab() {
  const { t } = useTranslation(["common", "settings"]);

  // --- Export state ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [availableModules, setAvailableModules] = useState<readonly BackupModuleInfo[]>([]);
  const [exportModules, setExportModules] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    http<{ modules: BackupModuleInfo[] }>("/backup/modules")
      .then((res) => {
        setAvailableModules(res.modules);
        setExportModules(new Set(res.modules.map(m => m.name)));
      })
      .catch(() => {});
  }, []);

  const resolvedExportModules = useMemo(
    () => resolveModuleDeps(exportModules, availableModules),
    [exportModules, availableModules],
  );

  const moduleDepsByName = useMemo(
    () => new Map(availableModules.map(m => [m.name, m.deps])),
    [availableModules],
  );

  const toggleExportModule = useCallback((mod: string) => {
    setExportModules((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) {
        const requiredBy = getRequiredByDeps(mod, next, availableModules);
        if (requiredBy.length > 0)
          return prev;
        next.delete(mod);
      }
      else {
        next.add(mod);
        for (const dep of moduleDepsByName.get(mod) ?? []) {
          next.add(dep);
        }
      }
      return next;
    });
  }, [availableModules, moduleDepsByName]);

  const handleExport = async () => {
    setExportConfirmOpen(false);
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      const res = await httpRaw("/backup/export", {
        method: "POST",
        body: JSON.stringify({ modules: [...resolvedExportModules] }),
      });

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(RE_FILENAME);
      const filename = filenameMatch?.[1] ?? `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(setExportSuccess, 3000, false);
    }
    catch (err) {
      setExportError(err instanceof Error ? err.message : t("settings:backup.export.failed"));
    }
    finally {
      setExporting(false);
    }
  };

  // --- Import state ---
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileModules, setImportFileModules] = useState<string[]>([]);
  // When checked, the operator opts in to restoring users / groups /
  // user_preferences. Off by default — the destructive nature (overwriting
  // the live user table) means we want a deliberate click. The backend
  // strips those tables when this flag is absent.
  const [importIncludeUsers, setImportIncludeUsers] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file)
      return;
    setImportFile(file);
    setImportError(null);
    setImportSuccess(null);
    setImportFileModules([]);
    setImportIncludeUsers(false);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        // Older versions are migrated server-side; only the shape is checked here.
        if (typeof data.version === "number" && Array.isArray(data.modules)) {
          setImportFileModules(data.modules);
        }
        else {
          setImportError(t("settings:backup.import.invalidFormat"));
          setImportFile(null);
        }
      }
      catch {
        setImportError(t("settings:backup.import.invalidJson"));
        setImportFile(null);
      }
    };
    reader.readAsText(file);
  }, [t]);

  const handleImport = async () => {
    if (!importFile)
      return;
    setImportConfirmOpen(false);
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      if (importIncludeUsers)
        formData.append("includeUsers", "true");

      const res = await httpRaw("/backup/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      setImportSuccess(t("settings:backup.import.success", { tables: result.tablesImported, rows: result.rowsImported }));
      setImportFile(null);
      setImportFileModules([]);
      setImportIncludeUsers(false);
      if (importFileRef.current)
        importFileRef.current.value = "";
    }
    catch (err) {
      setImportError(err instanceof Error ? err.message : t("settings:backup.import.failed"));
    }
    finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings:backup.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings:backup.description")}</p>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="size-4 text-muted-foreground" />
          <h3 className="font-semibold">{t("settings:backup.export.title")}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t("settings:backup.export.description")}</p>

        {exportError && <ErrorBanner message={exportError} />}
        {exportSuccess && (
          <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600">
            {t("settings:backup.export.success")}
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">{t("settings:backup.export.selectModules")}</Label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {availableModules.map(({ name: mod }) => {
              const isSelected = resolvedExportModules.has(mod);
              const isDep = !exportModules.has(mod) && isSelected;
              const id = `export-mod-${mod}`;
              return (
                <label
                  key={mod}
                  htmlFor={id}
                  className={`flex items-center gap-2 text-xs ${isDep ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDep}
                    onChange={() => toggleExportModule(mod)}
                    className="size-3.5 rounded border-border accent-primary"
                  />
                  {t(`settings:backup.modules.${mod}`, { defaultValue: mod })}
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" disabled={exporting || resolvedExportModules.size === 0} onClick={() => setExportConfirmOpen(true)}>
            <Download className="mr-1 size-3" />
            {exporting ? t("settings:backup.export.exporting") : t("settings:backup.export.button")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="size-4 text-muted-foreground" />
          <h3 className="font-semibold">{t("settings:backup.import.title")}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t("settings:backup.import.description")}</p>

        {importError && <ErrorBanner message={importError} />}
        {importSuccess && (
          <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600">
            {importSuccess}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("settings:backup.import.file")}</Label>
            <Input
              ref={importFileRef}
              type="file"
              accept=".json"
              onChange={handleImportFileChange}
            />
          </div>

          {importFileModules.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">{t("settings:backup.import.detectedModules")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {importFileModules.map(mod => (
                  <Badge key={mod} variant="secondary">{t(`settings:backup.modules.${mod}`, { defaultValue: mod })}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Users / groups / preferences are stripped server-side unless the
              operator explicitly opts in. The backup file ships them only when
              the export selected the `users` module — gate the checkbox on
              that signal so we never offer a no-op control. */}
          {importFileModules.includes("users") && (
            <label
              htmlFor="import-include-users"
              className="flex cursor-pointer items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs"
            >
              <input
                id="import-include-users"
                type="checkbox"
                className="mt-0.5"
                checked={importIncludeUsers}
                onChange={e => setImportIncludeUsers(e.target.checked)}
              />
              <span className="space-y-0.5">
                <span className="block font-medium text-destructive">
                  {t("settings:backup.import.includeUsersLabel")}
                </span>
                <span className="block text-muted-foreground">
                  {t("settings:backup.import.includeUsersHint")}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="destructive"
            disabled={!importFile || importing}
            onClick={() => setImportConfirmOpen(true)}
          >
            <Upload className="mr-1 size-3" />
            {importing ? t("settings:backup.import.importing") : t("settings:backup.import.button")}
          </Button>
        </div>
      </div>

      <Dialog open={exportConfirmOpen} onOpenChange={setExportConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings:backup.export.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings:backup.export.confirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
            <Button onClick={() => void handleExport()}>
              {t("settings:backup.export.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings:backup.import.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings:backup.import.confirmDescription")}</DialogDescription>
          </DialogHeader>
          {importFileModules.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {importFileModules.map(mod => (
                <Badge key={mod} variant="secondary">{t(`settings:backup.modules.${mod}`, { defaultValue: mod })}</Badge>
              ))}
            </div>
          )}
          {importFileModules.includes("users") && (
            <p className="px-1 text-xs">
              <span className="font-medium">
                {importIncludeUsers
                  ? t("settings:backup.import.confirmIncludeUsersOn")
                  : t("settings:backup.import.confirmIncludeUsersOff")}
              </span>
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
            <Button variant="destructive" onClick={() => void handleImport()}>
              {t("settings:backup.import.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
