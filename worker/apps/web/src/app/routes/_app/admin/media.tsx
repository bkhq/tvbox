import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/media")({
  staticData: { titleKey: "media:page.title" },
});
