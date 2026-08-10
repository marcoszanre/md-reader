# Spec — MD Reader (leitor de Markdown desktop para Windows)

> Documento de especificação para ser entregue a um agente de coding (Claude Code, Codex, Cursor, GitHub Copilot Agent, etc.).

---

## 1. Objetivo

Criar um aplicativo desktop **Windows** que abra arquivos `.md` avulsos com duplo clique e renderize o conteúdo formatado, do jeito que o Word abre um `.docx`.

**Não é** um editor. **Não é** um PKM. **Não tem** vault, workspace, banco de dados, sync, plugins ou conta de usuário.

### Critério de sucesso (o "definition of done" do MVP)

1. Duplo clique em um `.md` no Explorer abre o app com o documento renderizado.
2. Abre um arquivo de 5 MB em menos de 1 segundo.
3. Instalável em uma máquina Windows corporativa sem privilégio de administrador.
4. O app não faz **nenhuma** requisição de rede.

---

## 2. Não-objetivos (explícito, para o agente não inventar escopo)

- Sem edição de texto (leitura apenas no MVP).
- Sem sincronização em nuvem, telemetria, analytics ou auto-update.
- Sem sistema de plugins.
- Sem suporte a macOS/Linux no MVP (o código não deve impedir, mas não é alvo).
- Sem árvore de arquivos / sidebar de pastas no MVP.

---

## 3. Stack técnica

| Camada | Escolha | Justificativa |
|---|---|---|
| Shell desktop | **Electron** (versão estável mais recente) | Empacotamento simples no Windows, sem toolchain Rust/C++ |
| Bundler | **electron-vite** | HMR rápido, config mínima |
| UI | **HTML + CSS + TypeScript vanilla** | Não usar React/Vue — o app é essencialmente um `<article>` |
| Parser Markdown | **markdown-it** | CommonMark-compliant, extensível via plugins |
| Sanitização | **DOMPurify** | Obrigatório, ver Seção 8 |
| Syntax highlight | **Shiki** ou **highlight.js** | Shiki se o tamanho do bundle não for problema |
| Diagramas | **Mermaid** | Renderização client-side |
| Matemática | **KaTeX** | Mais leve que MathJax |
| Empacotamento | **electron-builder** | Gera NSIS installer + portable `.exe` |

### Alternativa considerada e rejeitada

**Tauri** produziria um binário muito menor (~5 MB vs ~150 MB), mas exige toolchain Rust e WebView2 na máquina. Para uma VM corporativa onde a prioridade é "instalar e funcionar", Electron é a aposta mais segura. Se o tamanho do instalador virar um problema, migrar depois é viável — a camada de renderização é agnóstica.

---

## 4. Funcionalidades

### 4.1 MVP (obrigatório)

**Abertura de arquivos**
- Argumento de linha de comando: `mdreader.exe "C:\caminho\arquivo.md"`.
- Associação de extensão no Windows para `.md`, `.markdown`, `.mdown`, `.mkd` (opcional durante a instalação, via checkbox — **não** marcar por padrão).
- Drag & drop de um arquivo na janela.
- `Ctrl+O` abre o diálogo nativo de arquivo.
- Múltiplos arquivos abertos = múltiplas abas (ver 4.2) ou múltiplas janelas.

**Renderização**
- CommonMark completo + GitHub Flavored Markdown: tabelas, task lists (`- [ ]`), strikethrough, autolink.
- Front matter YAML: detectar e renderizar em bloco recolhido no topo (não jogar como texto solto).
- Blocos de código com highlight por linguagem + botão "copiar".
- Blocos ` ```mermaid ` renderizados como diagrama.
- Matemática: `$inline$` e `$$bloco$$`.
- Imagens com caminho relativo resolvidas a partir do diretório do arquivo `.md`.
- Links internos (`#ancora`) fazem scroll suave. Links externos (`http/https`) abrem no browser padrão do sistema, **nunca** dentro do app.

**Navegação e leitura**
- Painel de sumário (TOC) gerado dos headings, recolhível, com `Ctrl+\`.
- Busca no documento com `Ctrl+F`: destaca ocorrências, `Enter`/`Shift+Enter` navega, contador "3 de 17".
- Zoom: `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, persistido entre sessões.
- Largura de leitura fixa e confortável (~70–80 caracteres), centralizada, com opção de "largura total".

**Live reload**
- Observar o arquivo no disco (`fs.watch` com debounce de ~150 ms) e re-renderizar em alterações externas, **preservando a posição de scroll**. Isso é o que torna o app útil quando você edita o `.md` no VS Code e lê aqui do lado.

**Tema**
- Claro / escuro / seguir o sistema. Persistir a escolha.
- Tipografia legível por padrão (algo próximo do estilo GitHub, não Times New Roman).

**Exportação**
- "Exportar para PDF" via `webContents.printToPDF`, respeitando o tema claro.
- `Ctrl+P` para impressão, com CSS de print dedicado (sem TOC, sem chrome da UI).

### 4.2 Fase 2 (depois que o MVP estiver estável)

- Abas para múltiplos documentos, com `Ctrl+Tab` e `Ctrl+W`.
- Lista de recentes na tela inicial e no menu.
- Resolver links relativos entre arquivos `.md` (clicar em `[outro](./outro.md)` abre no app, não no browser).
- Sidebar opcional de pastas (aqui você começa a virar Obsidian — pense bem antes).
- Modo de apresentação: `---` divide slides.

---

## 5. Interface

```
┌──────────────────────────────────────────────────────────┐
│  spec-md-reader.md                      ─  □  ✕          │  ← title bar
├────────────┬─────────────────────────────────────────────┤
│  SUMÁRIO   │                                             │
│            │   # Spec — MD Reader                        │
│  Objetivo  │                                             │
│  Stack     │   Documento de especificação para...        │
│  Features  │                                             │
│    MVP     │   ## 1. Objetivo                            │
│    Fase 2  │                                             │
│  Interface │   Criar um aplicativo desktop Windows...    │
│            │                                             │
├────────────┴─────────────────────────────────────────────┤
│  1.240 palavras · ~6 min de leitura        ☀/🌙   100%   │  ← status bar
└──────────────────────────────────────────────────────────┘
```

- Sem título/menu pesado. Barra de menu nativa mínima (Arquivo, Ver, Ajuda).
- Estado vazio: área de drop com "Arraste um arquivo .md aqui ou Ctrl+O".
- Toda a UI em português do Brasil.

---

## 6. Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+O` | Abrir arquivo |
| `Ctrl+W` | Fechar aba/janela |
| `Ctrl+F` | Buscar no documento |
| `Ctrl+P` | Imprimir |
| `Ctrl+\` | Alternar sumário |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+Shift+T` | Alternar tema |
| `F5` | Recarregar arquivo |
| `F11` | Tela cheia |
| `Esc` | Fechar busca / sair da tela cheia |

---

## 7. Arquitetura

```
mdreader/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts           # bootstrap, ciclo de vida, janelas
│   │   ├── window.ts          # criação de BrowserWindow, estado (posição/tamanho)
│   │   ├── file-handler.ts    # leitura, argv, drag&drop, fs.watch
│   │   ├── menu.ts            # menu nativo
│   │   └── settings.ts        # persistência em JSON no userData
│   ├── preload/
│   │   └── index.ts           # contextBridge — API mínima e explícita
│   └── renderer/
│       ├── index.html
│       ├── main.ts
│       ├── markdown/
│       │   ├── parser.ts      # markdown-it + plugins
│       │   ├── sanitize.ts    # DOMPurify
│       │   ├── mermaid.ts
│       │   └── katex.ts
│       ├── ui/
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

### Contrato do preload

O renderer **não** tem acesso a Node. Exponha exatamente isto e nada mais:

```ts
interface MdReaderAPI {
  openFileDialog(): Promise<{ path: string; content: string } | null>
  readFile(path: string): Promise<string>
  onFileOpened(cb: (payload: { path: string; content: string }) => void): void
  onFileChanged(cb: (payload: { path: string; content: string }) => void): void
  openExternal(url: string): Promise<void>
  exportPdf(defaultName: string): Promise<string | null>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<void>
}
```

### Settings persistidos

```ts
interface Settings {
  theme: 'light' | 'dark' | 'system'
  zoom: number            // 0.5 – 3.0
  tocVisible: boolean
  readingWidth: 'comfortable' | 'full'
  recentFiles: string[]   // máx. 20
  windowBounds: { x: number; y: number; width: number; height: number }
}
```

Gravar em `app.getPath('userData')/settings.json`. Se o arquivo estiver corrompido, ignorar e usar os defaults — nunca crashar por causa de settings.

---

## 8. Segurança (não negociável)

O app abre arquivos arbitrários que podem conter HTML embutido. Trate todo conteúdo de `.md` como **não confiável**.

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- Toda saída do markdown-it passa por **DOMPurify** antes de ir para o DOM. Sem exceção, sem flag de "permitir HTML bruto".
- Content-Security-Policy restritiva: sem `unsafe-eval`, sem `connect-src` remoto. Imagens: permitir `file:` e `data:`; considerar bloquear `http(s):` por padrão com um aviso "imagens remotas bloqueadas — carregar?".
- `window.open` e navegação para fora do app: interceptar em `setWindowOpenHandler` e `will-navigate`, sempre delegando ao `shell.openExternal`.
- Validar que o caminho recebido existe e é um arquivo antes de ler; limitar tamanho (ex.: avisar acima de 20 MB).
- Zero dependências de rede em runtime. Nenhuma fonte, CSS ou script vindo de CDN — tudo empacotado localmente.

---

## 9. Performance

- Arquivos até 10 MB devem renderizar em menos de 1 s.
- Debounce de 150 ms no file watcher.
- Mermaid e KaTeX devem ser **lazy-loaded**: só carregue os módulos se o documento contiver, respectivamente, um bloco `mermaid` ou delimitadores de matemática.
- Diagramas Mermaid renderizados de forma assíncrona, com placeholder — um diagrama malformado não pode travar a renderização da página inteira. Envolver em try/catch e mostrar o código-fonte como fallback.
- Se o documento tiver mais de ~5.000 nós, considerar renderização incremental. Não otimizar isso preventivamente — medir primeiro.

---

## 10. Empacotamento

`electron-builder` gerando dois artefatos:

1. **NSIS installer** — instalação por usuário (`perMachine: false`), sem exigir admin. Checkbox opcional e desmarcada por padrão para associar as extensões `.md`.
2. **Portable `.exe`** — arquivo único, sem instalação. Este é o alvo mais importante para VM corporativa: se a política bloquear instaladores, o portable ainda funciona.

O binário não é assinado. No Windows isso significa aviso do SmartScreen na primeira execução — esperado para uso pessoal, mas **verifique a política de software da sua organização antes de rodar em máquina corporativa**. Um `.exe` não assinado compilado localmente é uma coisa; distribuí-lo para colegas é outra.

---

## 11. Testes

- **Unitários (Vitest)**: pipeline de parsing, sanitização (incluindo payloads de XSS conhecidos), geração de TOC, resolução de caminhos relativos.
- **E2E (Playwright para Electron)**: abrir arquivo por argv, drag & drop, busca, alternância de tema, live reload.
- **Fixtures** em `test/fixtures/`, cobrindo: documento vazio, só front matter, tabelas grandes, Mermaid válido e inválido, KaTeX, imagens relativas quebradas, HTML malicioso, arquivo de 10 MB, emoji/CJK, CRLF vs LF.

---

## 12. Roadmap de implementação

O agente deve entregar em incrementos executáveis, não tudo de uma vez. Ao final de cada etapa o app deve rodar.

| Etapa | Entrega | Checkpoint |
|---|---|---|
| 1 | Scaffold Electron + Vite + TS, janela em branco | `npm run dev` abre a janela |
| 2 | Leitura de arquivo por argv/dialog + render markdown-it + DOMPurify | Abre um `.md` e mostra formatado |
| 3 | Tema claro/escuro + tipografia + CSS de leitura | Está agradável de ler |
| 4 | TOC + busca + zoom + persistência de settings | Navegação completa |
| 5 | Highlight de código + Mermaid + KaTeX (lazy) | Documentos técnicos renderizam |
| 6 | File watcher + preservação de scroll | Editar no VS Code atualiza aqui |
| 7 | Export PDF + CSS de print | Impressão limpa |
| 8 | electron-builder: NSIS + portable | Instalador gerado |
| 9 | Testes + tratamento de erro + polimento do estado vazio | Pronto para uso diário |

---

## 13. Instruções para o agente de coding

- Trabalhe **uma etapa por vez**, seguindo a Seção 12. Ao final de cada etapa, pare e confirme que o app roda antes de seguir.
- TypeScript em `strict` mode. Sem `any` sem justificativa em comentário.
- Não adicione dependências além das listadas na Seção 3 sem explicar o motivo.
- Não crie abstrações antecipadas. O app é pequeno — módulos diretos, sem camadas de fábrica/injeção.
- Trate erros de forma visível ao usuário: arquivo não encontrado, sem permissão, encoding inválido, markdown malformado. Cada um com mensagem própria em português. O app nunca deve mostrar tela branca sem explicação.
- Commits pequenos e descritivos, um por etapa no mínimo.
- Escreva um `README.md` com: como rodar em dev, como buildar, como associar as extensões, e a lista de atalhos.
