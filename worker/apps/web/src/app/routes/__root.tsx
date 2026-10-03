/* eslint-disable react-refresh/only-export-components */
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { NotFoundPage } from "@/shared/components/not-found";
import { useDocumentTitle } from "@/shared/hooks/use-page-title";
import { BASE_PATH, onHttpEvent } from "@/shared/lib/http";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const BYPASS_SUFFIXES = ["/denied", "/login", "/totp-verify", "/error"];

function redirectToLogin() {
  // Carry the query string too so deep-link context (filters, ids,
  // tabs) survives the session-expiry bounce — matches the redirect
  // value `_app.tsx` builds for its own guard.
  const current = window.location.pathname + window.location.search;
  if (BYPASS_SUFFIXES.some(s => current.startsWith(`${BASE_PATH}${s}`)))
    return;
  window.location.href = `${BASE_PATH}/login?redirect=${encodeURIComponent(current)}`;
}

function RootLayout() {
  useDocumentTitle();

  useEffect(() => {
    return onHttpEvent((type) => {
      if (type === "unauthorized")
        redirectToLogin();
    });
  }, []);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  );
}
