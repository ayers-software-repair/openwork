// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./demo-app";
import "../../app/index.css";

class DemoBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main style={{ padding: 32 }}><h1>The workspace could not load.</h1><button onClick={() => location.reload()}>Reload</button><p><a href="https://howland.si/">Return to Howland</a></p></main> : this.props.children; }
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing demo mount.");
createRoot(root).render(<DemoBoundary><DemoApp /></DemoBoundary>);
