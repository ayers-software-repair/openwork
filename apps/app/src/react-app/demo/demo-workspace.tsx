// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { createDemoClient, type DemoWorkspace } from "./demo-client";

type Client = ReturnType<typeof createDemoClient>;
function DocumentPages({ client, version, revision, onError }: { client: Client; version: "original" | "current";
  revision: string; onError(message: string): void }) {
  const [pages, setPages] = React.useState<string[]>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setPages([]);
    Promise.all(([1, 2] as const).map(page => client.document(version, page, controller.signal)))
      .then(blobs => {
        if (controller.signal.aborted) return;
        for (const blob of blobs) urls.push(URL.createObjectURL(blob));
        setPages([...urls]);
      }).catch(() => { if (!controller.signal.aborted) onError("The document preview could not load. Try a new conversation."); });
    return () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url); };
  }, [client, version, revision, onError]);
  return <div className="howland-demo-pages">{pages.map((url, index) => <img key={url} src={url}
    alt={`${version === "original" ? "Original" : "Current"} proposal, page ${index + 1}`} width="773" height="1000" />)}</div>;
}

export function DemoWorkspacePanel({ client, workspace, onError }: { client: Client; workspace: DemoWorkspace; onError(message: string): void }) {
  const [view, setView] = React.useState("result");
  const [phone, setPhone] = React.useState(true);
  React.useEffect(() => { setView("result"); }, [workspace.mode]);
  async function download(version: "original" | "current") {
    try {
      const url = URL.createObjectURL(await client.document(version));
      const link = document.createElement("a"); link.href = url; link.download = `Harbor-Repair-${version}.pdf`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { onError("The PDF could not be downloaded. Try a new conversation."); }
  }
  return <section className="howland-demo-workspace" aria-label={workspace.mode === "work" ? "Document workspace" : "Website workspace"}>
    <header className="howland-demo-result-head"><h1>{workspace.mode === "work" ? "Harbor Repair proposal" : "Harbor Repair website"}</h1>
      <div role="group" aria-label="Result view">{["result", "changes", "source"].map(item => <Button key={item} size="sm" variant="ghost"
        aria-pressed={view === item} onClick={() => setView(item)}>{item === "result" ? "Preview" : item === "changes" ? "Changes" : "Source"}</Button>)}</div>
    </header>
    {workspace.checks.length > 0 && <div className="howland-demo-checks" aria-label="Completed checks"><span>Revision {workspace.revision}</span>
      {workspace.checks.map(check => <span key={check}>{check}</span>)}</div>}
    <div className="howland-demo-result-body">
      {view === "source" ? <pre className="howland-demo-source"><code>{workspace.source}</code></pre>
        : view === "changes" ? <div className="howland-demo-changes"><h2>{workspace.filename}</h2>
          {workspace.changes.length ? workspace.changes.map((change, index) => <div key={index}>
            <pre><del>{change.before}</del></pre><pre><ins>{change.after}</ins></pre></div>) : <p>No changes applied.</p>}</div>
        : workspace.mode === "work" ? <div className={`howland-demo-documents${workspace.revision === "original" ? " is-original" : ""}`}>
          <section><header><h2>Original</h2><Button size="sm" variant="outline" onClick={() => void download("original")}>Download PDF</Button></header>
            <DocumentPages client={client} version="original" revision="original" onError={onError} /></section>
          {workspace.revision !== "original" && <section><header><h2>Revised</h2><Button size="sm" variant="outline" onClick={() => void download("current")}>Download PDF</Button></header>
            <DocumentPages client={client} version="current" revision={workspace.revision} onError={onError} /></section>}
        </div> : <div className="howland-demo-site-result">
          <div className="howland-demo-preview-tools"><div role="group" aria-label="Preview size"><Button size="sm" variant="ghost" aria-pressed={phone} onClick={() => setPhone(true)}>Phone</Button>
            <Button size="sm" variant="ghost" aria-pressed={!phone} onClick={() => setPhone(false)}>Desktop</Button></div>
            <span>{workspace.revision === "original" ? "Original website" : `Deployed preview ${workspace.revision}`}</span></div>
          <iframe key={workspace.preview} src={workspace.preview} title="Harbor Repair website preview" sandbox="allow-scripts" referrerPolicy="no-referrer"
            className={phone ? "is-phone" : "is-desktop"} />
        </div>}
    </div>
  </section>;
}
