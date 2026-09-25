# MD Reader

**A Markdown reader for Windows.** Double-click a `.md` file and it opens as a
properly formatted document, much like Word opens a `.docx` file.

MD Reader is a reader first, with lightweight Markdown editing when needed. It does
not have vaults, workspaces, databases, sync, plugins, or user accounts. It does not
make network requests to render your document.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Why it exists

Windows does not include a polished Markdown viewer. The usual alternatives are
opening Markdown in a code editor, manually converting it to HTML, or installing an
entire PKM tool just to read one file. MD Reader does one thing well: **it makes the
document readable and stays out of the way**.

## Features

### Reading
- CommonMark and GitHub Flavored Markdown: tables, task lists, strikethrough, and
  autolinks.
- YAML front matter appears in a collapsible block at the top instead of being shown
  as loose document text.
- Code blocks include syntax highlighting and a **Copy** button.
- **Mermaid** diagrams and **KaTeX** math are loaded on demand, only when the
  document uses them.
- Relative image paths are resolved from the document folder, including examples such
  as `../assets/photo.png`, a common documentation repository pattern.
- **Image viewer**: open `.png`, `.jpg`, `.gif`, `.webp`, `.svg`, and related image
  formats directly in the app, centered, with pixel dimensions in the status bar.
- **Read-only text viewer**: `.json`, `.html`, `.js`, `.ts`, `.yaml`, `.csv`, `.sql`,
  `.ps1`, and other text files open with syntax highlighting and line counts. The
  text/code viewer does not edit or write those files.
- Dark theme by default, light theme, or system theme; zoom; comfortable reading width
  or full-width layout with wide-screen margins.

### Lightweight Markdown editing
- **Edit in place**: the status-bar **✎ Edit** button, or `Ctrl+E`, turns on edit
  mode. The document stays rendered exactly as in reading mode; a thin accent line at
  the top of the page is the only visual change.
- Hovering a block subtly highlights it. Clicking a heading, paragraph, list, table,
  quote, code block, diagram, math block, or front matter block turns only that block
  into its Markdown source in place. The inline field keeps the visual weight of the
  rendered block, so headings stay large and code stays monospaced.
- Clicking outside the block, clicking another block, pressing `Esc`, or pressing
  `Ctrl+Enter` closes the block, re-renders it, and saves the file automatically with
  an atomic write. `Ctrl+S` simply writes pending changes immediately.
- `Ctrl+Z` and `Ctrl+Y` (or `Ctrl+Shift+Z`) undo and redo whole block edits while no
  block is open. Inside an open block, normal text undo applies.
- **+ Add a paragraph** at the end of the document appends new content. Inside a
  block, `Enter` continues lists and ends them on an empty item, `Tab` indents,
  `Ctrl+B` applies bold, and `Ctrl+I` applies italic. Deleting all text in a block
  removes that block.
- While editing, plain-clicking links does not navigate; `Ctrl+click` follows them.
  Press `Esc` with no block open, `Ctrl+E`, or **✓ Done** to leave edit mode.
- The status bar gives short guidance: "Click any block to edit", "Click outside or
  press Esc to finish", "Saving...", "✓ Saved", or "● Not saved" if a save failed.
- Edit mode is available only for Markdown files. Images and text/code files remain
  read-only, as do Markdown files that are not valid UTF-8 (for example, legacy
  Windows-1252 text), so saving can never corrupt their characters.
- If the file changes on disk while edits are pending, MD Reader asks before
  overwriting. If nothing is pending, the view follows the file on disk. Closing,
  reloading, or opening another file while a block has unwritten text prompts before
  continuing. Encoding, BOM, and line endings are preserved.

### Navigation
- Split sidebar: **Table of contents** above **Files**, with draggable dividers whose
  positions are restored between sessions.
- Obsidian-style folder explorer showing **all folder contents**. Binary files
  (executables, `.zip`, `.pdf`, Office files, and similar formats) are shown as
  **disabled** so they remain visible as context.
- Back/forward history, including mouse side buttons.
- **Minimap**, VS Code style, along the right edge: a compact overview of the whole
  document with readable section titles, code blocks, tables, and images. Click to
  jump, drag the viewport slider to scroll, and see search matches marked along the
  edge. Toggle it with the **▥** button or `Ctrl+M`; the choice is remembered, and the
  minimap hides automatically in narrow windows and in the image viewer.
- In-document search with a counter such as "3 of 17"; it closes when you click
  outside the search box.
- Direct scrolling without animation, because moving through a long document should
  feel immediate.

### Workflow
- **Live reload**: edit a `.md` file in VS Code and read it side by side in MD Reader;
  the page updates while preserving scroll position. If the content did not change,
  the document is not rendered again.
- **Copy Markdown**: the status-bar **Copy Markdown** button copies the entire raw
  Markdown source of the open document to the clipboard, including the current text of
  an open block. Shortcut: `Ctrl+Shift+M`.
- Restores the monitor, size, and maximized state from the previous session.
- PDF export and dedicated print CSS without the table of contents or application UI.

### Copilot panel
- Chat with the [Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk)
  about the open document, using the GitHub Copilot CLI already authenticated on the
  machine.
- Streaming responses, contextual suggestions, and per-window history.
- **No automatic tool approval**: only reads inside the document folder are allowed.
  See [SECURITY.md](SECURITY.md#copilot-prompt-injection-xpia).

## Installation

Download the installer or portable build from [Releases](../../releases), or build it
locally:

```bash
git clone https://github.com/marcoszanre/md-reader.git
cd md-reader
npm install
npm run dist
```

This creates two artifacts in `release/`:

| Artifact | When to use it |
|---|---|
| `MDReader-<version>-setup.exe` | Per-user installation that does not require administrator privileges. During installation, an optional checkbox associates `.md`, `.markdown`, `.mdown`, and `.mkd` files with MD Reader. The checkbox is off by default. |
| `MDReader-<version>-portable.exe` | Single-file portable build with no installation. Use this on machines where installers are blocked. |

> The binaries are **not signed**. SmartScreen may warn on first launch. Check your
> organization's software policy before running the app on a managed device.

### Add to "Open with" without installing

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1
# undo:
powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1 -Unregister
```

The script writes only to `HKCU`; administrator privileges are not required.

## Development

```bash
npm run dev        # window with HMR
npm run typecheck  # strict TypeScript for all three processes
npm test           # Vitest, including known XSS payloads
npm run build      # creates out/
npm run dist:dir   # packages without an installer
```

Open a specific file during development:

```bash
npx electron . "C:\path\to\file.md"
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open file |
| `Ctrl+N` | New window |
| `Ctrl+W` | Close window |
| `Alt+←` / `Alt+→` | Go back / forward in history |
| `Ctrl+F` | Search (`Enter` / `Shift+Enter` navigates) |
| `Ctrl+P` | Print |
| `Ctrl+E` | Edit Markdown in place / finish editing |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo a block edit |
| `Ctrl+Shift+Z` | Redo a block edit |
| `Ctrl+Shift+M` | Copy the raw Markdown source of the open document |
| `Ctrl+Shift+P` | Copy the path of the open file |
| `Ctrl+\` | Show/hide the sidebar |
| `Ctrl+Shift+C` | Open/close the Copilot panel |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom; `Ctrl` + mouse wheel also works |
| `Ctrl+Shift+T` | Toggle theme |
| `Ctrl+Shift+W` | Toggle reading width |
| `Ctrl+M` | Show/hide the minimap |
| `F5` | Reload file |
| `F11` | Full screen |
| `Esc` | Close search or Copilot; close an open block; finish editing when no block is open |
| `PageUp` `PageDown` `Home` `End` | Scroll |

## Security

A document reader opens files from unknown sources, so security is a core design
requirement:

- All HTML derived from Markdown is sanitized with **DOMPurify** before it reaches the
  DOM.
- The renderer runs with `sandbox`, `contextIsolation`, no Node access, and a
  restrictive CSP.
- Local images are served by a dedicated protocol restricted to folders of opened
  documents, using `realpath` checks to defend against symlinks and junctions.
- Network paths such as `\\host\...` are blocked to prevent silent NTLM hash leaks.
- Markdown saving is deliberately narrow: block-to-source mapping uses per-render
  random nonce attributes so a document cannot forge edit targets, the renderer can
  request saving only the currently open Markdown document for its own window, the
  main process chooses the path, writes are atomic, content size is bounded at 20 MB,
  and nothing is written without an explicit edit.
- The Copilot panel does **not** approve tools automatically and treats document
  content as untrusted data.

Full details and vulnerability reporting instructions: **[SECURITY.md](SECURITY.md)**.

## Performance

- Opens 10 MB files in under one second.
- Mermaid and KaTeX are loaded on demand and do not affect the critical path.
- Very large documents use `content-visibility` so the browser renders mainly the
  area near the viewport.
- Non-critical work, such as statistics and table-of-contents observation, runs during
  idle time.
- Live reload ignores saves that do not change document content.

## Architecture

```
src/
├── main/        # lifecycle, windows, file reads, file writes, watcher,
│                # mdasset:// protocol, Copilot integration
├── preload/     # contextBridge with a minimal explicit API
├── renderer/    # UI: Markdown, editor, table of contents, search, theme,
│                # zoom, explorer, Copilot
└── shared/      # types shared between processes
```

**Stack**: Electron, electron-vite, strict TypeScript, vanilla HTML/CSS/TS in the
renderer (the app is essentially an `<article>` plus focused controls), markdown-it,
DOMPurify, highlight.js, Mermaid, KaTeX, and electron-builder.

## License

[MIT](LICENSE)
