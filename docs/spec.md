# Spec — MD Reader (desktop Markdown reader for Windows)

> Specification document for a coding agent such as Claude Code, Codex, Cursor,
> GitHub Copilot Agent, or a similar implementation assistant.

---

## 1. Objective

Create a **Windows** desktop app that opens standalone `.md` files by double-click
and renders them as formatted documents, much like Word opens a `.docx` file.

MD Reader is a Markdown reader first, with lightweight editing when needed. It is
**not** a PKM system. It has **no** vaults, workspaces, databases, sync, plugins, or
user accounts.

### Success criteria for the MVP

1. Double-clicking a `.md` file in Explorer opens the app with the document rendered.
2. A 5 MB file opens in under one second.
3. The app can be installed on a corporate Windows machine without administrator
   privileges.
4. The app makes **no** network requests to render documents.

---

## 2. Explicit non-goals

- No cloud sync, telemetry, analytics, or auto-update.
- No plugin system.
- No macOS/Linux support in the MVP. The code should not make those platforms
  impossible, but they are not targets.
- No rich authoring environment, collaborative editing, preview publishing, or
  repository management.
- No editing for images or non-Markdown text/code files; those viewers remain
  read-only.

---

## 3. Technical stack

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | **Electron** using the latest stable major version | Straightforward Windows packaging without requiring a Rust/C++ toolchain |
| Bundler | **electron-vite** | Fast HMR and minimal configuration |
| UI | **Vanilla HTML, CSS, and TypeScript** | Avoid React/Vue; the app is essentially an `<article>` plus focused controls |
| Markdown parser | **markdown-it** | CommonMark-compliant and extensible through plugins |
| Sanitization | **DOMPurify** | Required; see Section 8 |
| Syntax highlighting | **Shiki** or **highlight.js** | Prefer Shiki if bundle size remains acceptable |
| Diagrams | **Mermaid** | Client-side rendering |
| Math | **KaTeX** | Lighter than MathJax |
| Packaging | **electron-builder** | Produces an NSIS installer and portable `.exe` |

### Considered and rejected alternative

**Tauri** would produce a much smaller binary, but it requires a Rust toolchain and
WebView2 on the target machine. For a corporate Windows VM where the priority is
"install and run," Electron is the safer default. If installer size becomes a
problem, migrating later is viable because the rendering layer is mostly platform
agnostic.

---

## 4. Features

### 4.1 MVP

**Opening files**
- Command-line argument: `mdreader.exe "C:\path\to\file.md"`.
- Windows extension association for `.md`, `.markdown`, `.mdown`, and `.mkd`,
  optionally enabled during installation through an unchecked-by-default checkbox.
- Drag and drop a file into the window.
- `Ctrl+O` opens the native file picker.
- Multiple open files can use multiple windows.

**Rendering**
- Full CommonMark plus GitHub Flavored Markdown: tables, task lists (`- [ ]`),
  strikethrough, and autolinks.
- YAML front matter is detected and rendered as a collapsed block at the top instead
  of loose document text.
- Code blocks include per-language highlighting and a **Copy** button.
- Fenced Mermaid code blocks render as diagrams.
- Math support: `$inline$` and `$$block$$`.
- Relative image paths are resolved from the directory of the `.md` file.
- Internal links such as `#anchor` scroll within the document. External `http` and
  `https` links open in the system default browser, **never** inside the app.

**Lightweight Markdown editing**
- The status-bar **✎ Edit** button, or `Ctrl+E`, turns on edit mode. The document
  remains rendered exactly as it appears in reading mode; a thin accent line at the
  top of the page is the only persistent visual change.
- Hovering a block subtly highlights it. Supported blocks include headings,
  paragraphs, lists, tables, quotes, code blocks, diagrams, math, and front matter.
- Clicking a block turns only that block into its Markdown source in place. The source
  field keeps the visual weight of the rendered block, so headings stay large and
  code remains monospaced. The caret lands near the word that was clicked.
- Clicking outside the block, clicking another block, pressing `Esc`, or pressing
  `Ctrl+Enter` closes the block, re-renders it, and saves the file automatically with
  an atomic write.
- `Ctrl+S` is optional and only forces pending changes to be written immediately.
- `Ctrl+Z` and `Ctrl+Y` (or `Ctrl+Shift+Z`) undo and redo whole block edits while no
  block is open. Inside an open block, normal text undo applies.
- **+ Add a paragraph** at the end of the document appends new content.
- Inside a block, `Enter` continues lists and ends them on an empty item, `Tab`
  indents, `Ctrl+B` applies bold, and `Ctrl+I` applies italic. Deleting all text in a
  block removes it.
- While editing, links do not navigate on a plain click; `Ctrl+click` follows them.
- `Esc` with no block open, `Ctrl+E`, or the **✓ Done** button leaves edit mode.
- The status bar shows concise guidance: "Click any block to edit", "Click outside or
  press Esc to finish", "Saving...", "✓ Saved", or "● Not saved" if a save failed.
- Edit mode is available only for Markdown files. Image and text/code viewers remain
  read-only.
- If the file changed on disk while edits were pending, saving asks before
  overwriting. If nothing is pending, the view simply follows the file on disk.
- Closing the window, reloading, or opening another file while a block has unwritten
  text prompts first. Close uses **Save**, **Don't save**, and **Cancel**; reload and
  open use **Discard** and **Keep editing**.
- Preserve the file's encoding, BOM, and line endings when saving.

**Navigation and reading**
- Table-of-contents panel generated from headings, collapsible with `Ctrl+\`.
- In-document search with `Ctrl+F`: highlights matches, `Enter`/`Shift+Enter`
  navigates, and a counter shows values such as "3 of 17".
- Zoom: `Ctrl+=`, `Ctrl+-`, and `Ctrl+0`, persisted between sessions.
- Comfortable fixed reading width of roughly 70-80 characters, centered, with an
  optional full-width mode.

**Live reload**
- Watch the file on disk with `fs.watch` and approximately 150 ms debounce, then
  re-render on external changes while preserving scroll position. This is what makes
  the app useful when the document is edited in VS Code and read side by side in MD
  Reader.
- If the content did not change, do not re-render.
- Pause live reload for the active file while that file is in edit mode.

**Clipboard and export**
- **Copy Markdown** status-bar button copies the full raw Markdown source of the open
  document, including an open block's current text. Shortcut: `Ctrl+Shift+M`.
- Existing **Copy file path** action copies the path of the open file. Shortcut:
  `Ctrl+Shift+P`.
- "Export to PDF" uses `webContents.printToPDF` and a light print theme.
- `Ctrl+P` prints with dedicated print CSS, excluding the table of contents and app UI
  chrome.

**Theme**
- Light, dark, or follow system. Persist the selected option.
- Legible typography by default, close to GitHub's document style rather than
  desktop-office defaults.

### 4.2 Phase 2

- Tabs for multiple documents, with `Ctrl+Tab` and `Ctrl+W`.
- Recent files on the start screen and menu.
- Relative links between `.md` files, so clicking `[other](./other.md)` opens in the
  app instead of the browser.
- Optional folder sidebar. This starts moving the app toward an Obsidian-like scope,
  so it should be added deliberately.
- Presentation mode where `---` separates slides.

---

## 5. Interface

```
┌──────────────────────────────────────────────────────────┐
│  spec-md-reader.md                      -  □  X          │  ← title bar
├────────────┬─────────────────────────────────────────────┤
│  CONTENTS  │                                             │
│            │   # Spec — MD Reader                        │
│  Objective │                                             │
│  Stack     │   Specification document for...             │
│  Features  │                                             │
│    MVP     │   ## 1. Objective                           │
│    Phase 2 │                                             │
│  Interface │   Create a Windows desktop app...           │
│            │                                             │
├────────────┴─────────────────────────────────────────────┤
│  1,240 words · ~6 min read           Light/Dark   100%   │  ← status bar
└──────────────────────────────────────────────────────────┘
```

- No heavy title bar or menu. Keep the native menu minimal: File, View, Help.
- Empty state: drop area with "Drop a Markdown file here or press Ctrl+O".
- All visible UI text is English.
- Status bar includes reading statistics, theme, zoom, reading width, edit-state
  guidance, save status, Copy Markdown, and Copy file path when applicable.

---

## 6. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open file |
| `Ctrl+W` | Close tab/window |
| `Ctrl+F` | Search in document |
| `Ctrl+P` | Print |
| `Ctrl+E` | Edit Markdown in place / finish editing |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo a block edit |
| `Ctrl+Shift+Z` | Redo a block edit |
| `Ctrl+Shift+M` | Copy raw Markdown source |
| `Ctrl+Shift+P` | Copy open file path |
| `Ctrl+\` | Toggle table of contents |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+Shift+T` | Toggle theme |
| `Ctrl+M` | Show/hide the minimap (document overview on the right edge; click or drag to navigate) |
| `F5` | Reload file |
| `F11` | Full screen |
| `Esc` | Close search, close an open block, exit full screen, or finish editing when no block is open |

---

## 7. Architecture

```
mdreader/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts           # bootstrap, lifecycle, windows
│   │   ├── window.ts          # BrowserWindow creation and state
│   │   ├── file-handler.ts    # reads, writes, argv, drag and drop, fs.watch
│   │   ├── menu.ts            # native menu
│   │   └── settings.ts        # JSON persistence in userData
│   ├── preload/
│   │   └── index.ts           # contextBridge with a minimal explicit API
│   └── renderer/
│       ├── index.html
│       ├── main.ts
│       ├── markdown/
│       │   ├── parser.ts      # markdown-it and plugins
│       │   ├── sanitize.ts    # DOMPurify
│       │   ├── mermaid.ts
│       │   └── katex.ts
│       ├── ui/
│       │   ├── editor.ts
│       │   ├── toc.ts
│       │   ├── search.ts
│       │   ├── theme.ts
│       │   └── zoom.ts
│       └── styles/
│           ├── base.css
│           ├── theme-light.css
│           ├── theme-dark.css
│           └── print.css
└── resources/
    └── icon.ico
```

### Preload contract

The renderer has **no** Node access. Expose exactly the required API and nothing more:

```ts
interface MdReaderAPI {
  openFileDialog(): Promise<{ path: string; content: string } | null>
  readFile(path: string): Promise<string>
  saveCurrentMarkdown(content: string): Promise<{ saved: true; mtimeMs: number }>
  onFileOpened(cb: (payload: { path: string; content: string }) => void): void
  onFileChanged(cb: (payload: { path: string; content: string }) => void): void
  openExternal(url: string): Promise<void>
  exportPdf(defaultName: string): Promise<string | null>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<void>
}
```

`saveCurrentMarkdown` intentionally accepts content only. It does not accept a path.
The main process decides which file, if any, can be saved for the owning window.

### Persisted settings

```ts
interface Settings {
  theme: 'light' | 'dark' | 'system'
  zoom: number            // 0.5-3.0
  tocVisible: boolean
  readingWidth: 'comfortable' | 'full'
  recentFiles: string[]   // max 20
  windowBounds: { x: number; y: number; width: number; height: number }
}
```

Write settings to `app.getPath('userData')/settings.json`. If the file is corrupt,
ignore it and use defaults; settings corruption must never crash the app.

---

## 8. Security requirements

The app opens arbitrary files that may contain embedded HTML. Treat all `.md` content
as **untrusted**.

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- All markdown-it output passes through **DOMPurify** before entering the DOM. No
  exceptions and no "allow raw HTML" flag.
- Restrictive Content Security Policy: no `unsafe-eval` and no remote `connect-src`.
  Consider blocking `http(s):` images by default and showing a clear "Remote images
  are blocked; load them?" prompt.
- Intercept `window.open` and navigation outside the app through
  `setWindowOpenHandler` and `will-navigate`; always delegate allowed external URLs to
  `shell.openExternal`.
- Validate that the received path exists and is a file before reading. Enforce a size
  limit, for example warning or refusing above 20 MB.
- Network paths such as `\\host\share\file.md` are rejected.
- Runtime rendering has zero network dependencies. No fonts, CSS, or scripts come
  from a CDN; everything is packaged locally.

### Save security

- Only Markdown files can be edited.
- Block-to-source mapping uses per-render random nonce attributes, so a document
  cannot forge mappings to make edits land on other lines.
- The renderer may request saving only the **currently open Markdown document** for
  its own window.
- The renderer never sends a path when saving. It sends content only; the main process
  owns path selection and validation.
- No file is written without an explicit edit. Closing an edited block triggers the
  save; `Ctrl+S` may force pending changes to disk.
- Content size is bounded before writing; the app rejects files above 20 MB.
- Writes are atomic: write to a temporary file in the same directory, flush/close it,
  then rename it over the original file.
- Preserve encoding, BOM, and line endings when saving.
- If the file changed on disk while edits were pending, warn before overwriting.
- Non-Markdown text/code files remain read-only.

---

## 9. Performance

- Files up to 10 MB should render in under one second.
- File watcher debounce: approximately 150 ms.
- Mermaid and KaTeX must be **lazy-loaded**: load those modules only when the document
  contains, respectively, a Mermaid block or math delimiters.
- Mermaid diagrams render asynchronously with a placeholder. A malformed diagram must
  not block the entire page; show the source code as a fallback.
- If a document contains more than roughly 5,000 nodes, consider incremental
  rendering. Measure before optimizing.

---

## 10. Packaging

`electron-builder` produces two artifacts:

1. **NSIS installer**: per-user installation (`perMachine: false`) without
   administrator privileges. Optional unchecked-by-default checkbox to associate
   Markdown extensions.
2. **Portable `.exe`**: single file with no installation. This is the most important
   target for corporate VMs where installer execution may be blocked.

The binary is not signed. On Windows, this means SmartScreen may warn on first launch.
This is expected for personal use, but **check your organization's software policy
before running the app on a managed device**. A locally built unsigned `.exe` is one
thing; distributing it to colleagues is another.

---

## 11. Tests

- **Unit tests with Vitest**: parsing pipeline, sanitization including known XSS
  payloads, table-of-contents generation, relative-path resolution, edit-state
  transitions, and save validation.
- **E2E tests with Playwright for Electron**: opening by argv, drag and drop, search,
  theme switching, live reload, entering edit mode, editing a single block in place,
  auto-saving when the block closes, forcing pending writes with `Ctrl+S`, undoing and
  redoing block edits, following links with `Ctrl+click`, and prompting when closing
  with unwritten block text.
- **Fixtures** in `test/fixtures/`: empty document, front matter only, large tables,
  valid and invalid Mermaid, KaTeX, broken relative images, malicious HTML, a 10 MB
  file, emoji/CJK, and CRLF versus LF.

---

## 12. Implementation roadmap

The agent should deliver executable increments, not everything at once. At the end of
each step, the app should still run.

| Step | Deliverable | Checkpoint |
|---|---|---|
| 1 | Scaffold Electron + Vite + TypeScript with a blank window | `npm run dev` opens the window |
| 2 | File reading by argv/dialog + markdown-it rendering + DOMPurify | Opens a `.md` file and shows formatted content |
| 3 | Light/dark theme + typography + reading CSS | The document is comfortable to read |
| 4 | TOC + search + zoom + persisted settings | Navigation is complete |
| 5 | Code highlighting + Mermaid + KaTeX, loaded lazily | Technical documents render correctly |
| 6 | File watcher + scroll preservation | Editing in VS Code updates MD Reader |
| 7 | Inline block edit mode + atomic autosave | Edit, auto-save, undo/redo, conflict, and close-prompt flows work |
| 8 | Copy Markdown + copy file path + export PDF + print CSS | Clipboard and output flows work |
| 9 | electron-builder with NSIS + portable output | Installer artifacts are generated |
| 10 | Tests, error handling, and polished empty state | Ready for daily use |

---

## 13. Instructions for the coding agent

- Work **one step at a time**, following Section 12. At the end of each step, confirm
  that the app runs before continuing.
- Use TypeScript in `strict` mode. Do not use `any` without a justification comment.
- Do not add dependencies beyond those listed in Section 3 without explaining why.
- Do not create premature abstractions. The app is small; prefer direct modules over
  factory or dependency-injection layers.
- Show visible, specific errors for common failures: file not found, permission
  denied, invalid encoding, malformed Markdown-related content, save conflict, and
  save failure. The app must never show a blank screen without explanation.
- Use small descriptive commits, at least one per step.
- Write a `README.md` that explains how to run in development, build, associate file
  extensions, use edit mode, and use keyboard shortcuts.
