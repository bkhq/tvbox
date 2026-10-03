import type { NavItem } from "@/shared/components/sidebar/types";
import { MonitorSmartphone } from "lucide-react";

export const devicesNav: NavItem = {
  area: "admin",
  key: "devices",
  path: "/admin/devices",
  icon: MonitorSmartphone,
  order: 6,
};
