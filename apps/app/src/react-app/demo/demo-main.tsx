// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlatformProvider, createDefaultPlatform } from "@/react-app/kernel/platform";
import { initLocale } from "@/i18n";
import { DemoApp } from "./demo-app";
import "../../app/index.css";

class DemoBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main style={{ padding: 32 }}><h1>The conversation could not load.</h1><button onClick={() => location.reload()}>Reload</button><p><a href="https://howland.si/">Return to Howland</a></p></main> : this.props.children; }
}
initLocale();
const root = document.getElementById("root");
if (!root) throw new Error("Missing demo mount.");
const query = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
createRoot(root).render(<DemoBoundary><QueryClientProvider client={query}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><DemoApp /></PlatformProvider></TooltipProvider></QueryClientProvider></DemoBoundary>);
