import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/releases")({
  staticData: { titleKey: "releases:page.title" },
});
