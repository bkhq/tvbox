/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ClientsTab } from "./-media-clients";
import { HomeTab } from "./-media-home";
import { LiveTab } from "./-media-live";
import { PeopleTab } from "./-media-people";
import { TaxonomyTab } from "./-media-taxonomy";
import { TitlesTab } from "./-media-titles";

export const Route = createLazyFileRoute("/_app/admin/media")({
  component: MediaPage,
});

function MediaPage() {
  const { t } = useTranslation("media");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
      </div>

      <Tabs defaultValue="titles">
        <TabsList variant="line">
          <TabsTrigger value="titles">{t("tabs.titles")}</TabsTrigger>
          <TabsTrigger value="people">{t("tabs.people")}</TabsTrigger>
          <TabsTrigger value="taxonomy">{t("tabs.taxonomy")}</TabsTrigger>
          <TabsTrigger value="home">{t("tabs.home")}</TabsTrigger>
          <TabsTrigger value="live">{t("tabs.live")}</TabsTrigger>
          <TabsTrigger value="clients">{t("tabs.clients")}</TabsTrigger>
        </TabsList>
        <TabsContent value="titles"><TitlesTab /></TabsContent>
        <TabsContent value="people"><PeopleTab /></TabsContent>
        <TabsContent value="taxonomy"><TaxonomyTab /></TabsContent>
        <TabsContent value="home"><HomeTab /></TabsContent>
        <TabsContent value="live"><LiveTab /></TabsContent>
        <TabsContent value="clients"><ClientsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
