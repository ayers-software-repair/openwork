/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { act, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import * as den from "../src/app/lib/den";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { t } from "../src/i18n";

// Lexical detects DOM support at module initialization, so load the real editor after registration.
const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost:5173/" });
const previousActEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { ReactSessionComposer } = await import("../src/react-app/domains/session/surface/composer/composer");
const { $getRoot, $getSelection, $isRangeSelection, $isTextNode, CONTROLLED_TEXT_INSERTION_COMMAND, PASTE_COMMAND, getNearestEditorFromDOMNode } = await import("lexical");

afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  if (ownedDom) await GlobalRegistrator.unregister();
});

async function mount(initialDraft = "Hello") {
  const network = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected composer network request"); });
  const settings = spyOn(den, "readDenSettings");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    textOnly: true,
    draft: initialDraft,
    mentions: {},
    onDraftChange: mock((value: string) => { void value; }),
    onSend: mock(() => {}), onSteer: mock(() => {}), onQueue: mock(() => {}), onStop: mock(() => {}),
    busy: false, steering: false, submissionPreparing: false, queuedCount: 0, disabled: false,
    statusLabel: "Ready", modelPickerOpen: true,
    selectedModel: { providerID: "anthropic", modelID: "demo-model" },
    onModelPickerOpenChange: mock(() => {}), onModelChange: mock(() => {}),
    attachments: [], attachmentsEnabled: true, attachmentsDisabledReason: null,
    onAttachFiles: mock(() => {}), onRemoveAttachment: mock(() => {}),
    modelVariantLabel: "Default", modelVariant: null, onModelVariantChange: mock(() => {}),
    agentLabel: "Private agent", selectedAgent: "private-agent", onSelectAgent: mock(() => {}),
    listAgents: mock(async () => []), listCommands: mock(async () => []), listSkills: mock(async () => []),
    listMcp: mock(async () => ({ servers: [], statuses: {}, status: null })),
    listImportedPlugins: mock(async () => []), searchFiles: mock(async () => []),
    recentFiles: ["private-document.txt"], onInsertMention: mock(() => {}),
    onPasteText: mock(() => {}), onUnsupportedFileLinks: mock(() => {}), pastedText: [],
    onExpandPastedText: mock(() => {}), onRemovePastedText: mock(() => {}),
  } satisfies ComponentProps<typeof ReactSessionComposer>;
  function Harness({ busy }: { busy: boolean }) {
    const [draft, setDraft] = useState(initialDraft);
    return <TooltipProvider>
      <ReactSessionComposer {...props} busy={busy} draft={draft} onDraftChange={(value) => {
        props.onDraftChange(value);
        setDraft(value);
      }} />
    </TooltipProvider>;
  }
  async function dispose() {
    try { await act(async () => root.unmount()); }
    finally { container.remove(); network.mockRestore(); settings.mockRestore(); }
  }
  const render = async (busy = false) => { await act(async () => root.render(<Harness busy={busy} />)); };
  try { await render(); } catch (error) { await dispose(); throw error; }
  return {
    container, props, network, settings, render, dispose,
    editor() {
      const editor = container.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!editor) throw new Error("The real Lexical editor did not mount");
      return editor;
    },
    action() {
      const button = container.querySelector<HTMLButtonElement>("[data-composer-actions] button");
      if (!button) throw new Error("The composer action did not mount");
      return button;
    },
    assertNoInventories() {
      for (const inventory of [props.listAgents, props.listCommands, props.listSkills, props.listMcp, props.listImportedPlugins, props.searchFiles])
        expect(inventory).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      expect(settings).not.toHaveBeenCalled();
    },
  };
}

test("text-only composer mounts with only TooltipProvider and keeps real send and stop controls", async () => {
  const view = await mount();
  try {
    expect(view.editor().textContent).toBe("Hello");
    expect(view.action().getAttribute("aria-label")).toBe(t("composer.run_task"));
    expect(view.action().disabled).toBe(false);
    expect(view.container.querySelectorAll("button").length).toBe(1);
    expect(view.container.querySelector('input[type="file"], [role="menu"], [role="listbox"]')).toBeNull();
    expect(view.container.textContent).not.toContain("Private agent");
    expect(view.container.textContent).not.toContain("private-document.txt");
    await act(async () => view.action().click());
    expect(view.props.onSend).toHaveBeenCalledTimes(1);
    await view.render(true);
    expect(view.action().getAttribute("aria-label")).toBe(t("composer.stop"));
    await act(async () => view.action().click());
    expect(view.props.onStop).toHaveBeenCalledTimes(1);
    expect(view.props.onModelPickerOpenChange).not.toHaveBeenCalled();
    view.assertNoInventories();
  } finally { await view.dispose(); }
});

test("a large text-only paste replaces the real selection and leaves the caret after the inserted text", async () => {
  const view = await mount("Before selected after");
  const element = view.editor();
  const bounds = spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 80));
  const cloneNode = element.cloneNode.bind(element);
  // Happy DOM has no layout; only the overflow measurement needs supplied dimensions.
  const measurement = spyOn(element, "cloneNode").mockImplementation((deep) => {
    const clone = cloneNode(deep);
    if (clone instanceof HTMLElement) Object.defineProperties(clone, {
      scrollHeight: { value: 480 }, clientHeight: { value: 80 },
    });
    return clone;
  });
  try {
    const editor = getNearestEditorFromDOMNode(element);
    if (!editor) throw new Error("Mounted contenteditable has no Lexical editor");
    const pasted = "public text ".repeat(120);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", pasted);
    const paste = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
    await act(async () => {
      element.focus();
      editor.update(() => {
        const text = $getRoot().getFirstDescendant();
        if (!$isTextNode(text)) throw new Error("Expected the real draft text node");
        text.select(7, 15);
        editor.dispatchCommand(PASTE_COMMAND, paste);
      }, { discrete: true });
    });
    expect(measurement).toHaveBeenCalled();
    expect(view.props.onPasteText).not.toHaveBeenCalled();
    const expected = `Before ${pasted} after`;
    expect(element.textContent).toBe(expected);
    expect(view.props.onDraftChange).toHaveBeenCalledWith(expected);
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected a real Lexical range selection");
      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe(7 + pasted.length);
      expect(selection.anchor.getNode().getTextContent()).toBe(expected);
    });
    await act(async () => {
      editor.update(() => { editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "!"); }, { discrete: true });
    });
    expect(element.textContent).toBe(`Before ${pasted}! after`);
    view.assertNoInventories();
  } finally { bounds.mockRestore(); measurement.mockRestore(); await view.dispose(); }
});

for (const character of ["@", "/"]) {
  test(`typing ${character} through the mounted editor keeps literal text and loads no inventories`, async () => {
    const view = await mount("");
    try {
      expect(view.action().disabled).toBe(true);
      const editor = getNearestEditorFromDOMNode(view.editor());
      if (!editor) throw new Error("Mounted contenteditable has no Lexical editor");
      await act(async () => {
        // The real PlainTextPlugin handles this same command for controlled keyboard insertion.
        editor.update(() => {
          $getRoot().selectEnd();
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, character);
        }, { discrete: true });
      });
      expect(view.props.onDraftChange).toHaveBeenCalledWith(character);
      expect(view.editor().textContent).toBe(character);
      expect(view.action().disabled).toBe(false);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
      expect(view.container.querySelectorAll("button").length).toBe(1);
      expect(view.container.querySelector('[role="menu"], [role="listbox"]')).toBeNull();
      view.assertNoInventories();
      await act(async () => view.action().click());
      expect(view.props.onSend).toHaveBeenCalledTimes(1);
      expect(view.props.onInsertMention).not.toHaveBeenCalled();
    } finally { await view.dispose(); }
  });
}
