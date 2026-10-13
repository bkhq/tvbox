import type { NavItem } from "@/shared/components/sidebar/types";
import { Clapperboard } from "lucide-react";

export const mediaNav: NavItem = {
  area: "admin",
  key: "media",
  path: "/admin/media",
  icon: Clapperboard,
  order: 5.5,
};
