# MD Reader

**Um leitor de Markdown para Windows.** Duplo clique em um `.md` e ele abre formatado —
do jeito que o Word abre um `.docx`.

Não é editor. Não tem vault, workspace, banco de dados, sync, plugins ou conta de usuário.
Não faz nenhuma requisição de rede para renderizar o seu documento.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Plataforma](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-green)

---

## Por que existe

O Windows não tem um visualizador decente de Markdown. As opções são abrir num editor
de código (ruído demais para só ler), converter para HTML na mão, ou instalar um PKM
inteiro para ler um único arquivo. O MD Reader faz uma coisa só: **mostra o documento
bonito e sai da frente**.

## Recursos

### Leitura
- CommonMark + GitHub Flavored Markdown: tabelas, task lists, strikethrough, autolink.
- Front matter YAML em bloco recolhível no topo, em vez de virar texto solto.
- Blocos de código com destaque de sintaxe e botão **Copiar**.
- Diagramas **Mermaid** e matemática **KaTeX** — ambos carregados sob demanda, só quando
  o documento realmente usa.
- Imagens com caminho relativo resolvidas a partir da pasta do arquivo.
- Tema **escuro** (padrão), claro ou seguir o sistema; zoom; largura de leitura
  confortável ou total com margem em telas largas.

### Navegação
- Barra lateral dividida: **Sumário** em cima, **Arquivos** embaixo — com divisores
  arrastáveis cuja posição é preservada entre sessões.
- Explorador de pastas estilo Obsidian, para pular entre os `.md` vizinhos.
- Histórico com **voltar/avançar** (inclui os botões laterais do mouse).
- Busca no documento com contador "3 de 17"; fecha ao clicar fora.
- Scroll direto, sem animação — navegar por documento longo não deve ser uma viagem.

### Fluxo de trabalho
- **Live reload**: edite o `.md` no VS Code e leia aqui do lado; a página atualiza
  preservando a posição de scroll. Se o conteúdo não mudou, nem re-renderiza.
- Restaura **o monitor, o tamanho e o estado maximizado** da última sessão.
- Exportação para PDF e CSS de impressão dedicado (sem sumário, sem cromo de UI).

### Painel Copilot
- Converse com o [Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk)
  sobre o documento aberto, usando o GitHub Copilot CLI já autenticado na máquina.
- Streaming de resposta, sugestões contextuais e histórico por janela.
- **Sem aprovação automática de ferramentas**: apenas leitura dentro da pasta do
  documento é permitida. Veja [SECURITY.md](SECURITY.md#copilot-injeção-de-prompt-xpia).

## Instalação

Baixe o instalador ou o portable em [Releases](../../releases), ou compile você mesmo:

```bash
git clone https://github.com/marcoszanre/md-reader.git
cd md-reader
npm install
npm run dist
```

Isso gera dois artefatos em `release/`:

| Artefato | Quando usar |
|---|---|
| `MDReader-<versão>-setup.exe` | Instalação **por usuário**, sem exigir administrador. Durante a instalação há uma opção (desmarcada por padrão) para associar `.md`, `.markdown`, `.mdown` e `.mkd`. |
| `MDReader-<versão>-portable.exe` | Arquivo único, sem instalação. Ideal para máquinas onde instaladores são bloqueados. |

> Os binários **não são assinados**: o SmartScreen avisa na primeira execução.
> Verifique a política da sua organização antes de rodar em máquina corporativa.

### Associar ao "Abrir com" sem instalar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1
# desfazer:
powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1 -Unregister
```

Escreve apenas em `HKCU` — nenhum privilégio de administrador é necessário.

## Desenvolvimento

```bash
npm run dev        # janela com HMR
npm run typecheck  # TypeScript strict nos três processos
npm test           # Vitest (inclui payloads de XSS conhecidos)
npm run build      # gera out/
npm run dist:dir   # empacota sem instalador
```

Abrir um arquivo específico em desenvolvimento:

```bash
npx electron . "C:\caminho\arquivo.md"
```

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+O` | Abrir arquivo |
| `Ctrl+N` | Nova janela |
| `Ctrl+W` | Fechar janela |
| `Alt+←` / `Alt+→` | Voltar / avançar no histórico |
| `Ctrl+F` | Buscar (`Enter` / `Shift+Enter` navega) |
| `Ctrl+P` | Imprimir |
| `Ctrl+\` | Mostrar/ocultar a barra lateral |
| `Ctrl+Shift+C` | Abrir/fechar o painel do Copilot |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom (também `Ctrl` + roda do mouse) |
| `Ctrl+Shift+T` | Alternar tema |
| `Ctrl+Shift+W` | Largura de leitura |
| `F5` | Recarregar arquivo |
| `F11` | Tela cheia |
| `Esc` | Fechar busca / fechar Copilot |
| `PageUp` `PageDown` `Home` `End` | Rolagem |

## Segurança

Um leitor de documentos abre arquivos de origem desconhecida — então a segurança
não é um detalhe. Resumo:

- Todo HTML derivado do Markdown passa por **DOMPurify** antes de tocar o DOM.
- Renderer com `sandbox`, `contextIsolation` e sem acesso a Node; CSP restritiva.
- Imagens locais servidas por um protocolo próprio, restrito às pastas dos documentos
  abertos (com `realpath`, contra symlink/junção).
- Caminhos de rede (`\\host\...`) são bloqueados, evitando vazamento de hash NTLM.
- O painel do Copilot **não** aprova ferramentas automaticamente e trata o documento
  explicitamente como dado não confiável.

Detalhes completos e como reportar vulnerabilidades: **[SECURITY.md](SECURITY.md)**.

## Performance

- Abre arquivos de 10 MB em menos de um segundo.
- Mermaid e KaTeX carregados sob demanda (não entram no caminho crítico).
- Documentos muito grandes usam `content-visibility` para renderizar só o que está
  perto da viewport.
- Trabalho não crítico (estatísticas, observador do sumário) roda em tempo ocioso.
- Live reload ignora saves que não mudaram o conteúdo.

## Arquitetura

```
src/
├── main/        # ciclo de vida, janelas, leitura de arquivos, watcher,
│                # protocolo mdasset://, integração com o Copilot
├── preload/     # contextBridge — API mínima e explícita
├── renderer/    # UI: markdown, sumário, busca, tema, zoom, explorador, Copilot
└── shared/      # tipos compartilhados entre os processos
```

**Stack**: Electron + electron-vite + TypeScript (strict), HTML/CSS/TS vanilla no
renderer (o app é essencialmente um `<article>`), markdown-it, DOMPurify, highlight.js,
Mermaid, KaTeX, electron-builder.

## Licença

[MIT](LICENSE)
