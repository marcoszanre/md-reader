# Política de segurança

## Modelo de ameaça

O MD Reader abre arquivos `.md` que podem vir de qualquer lugar — e-mail, download,
repositório de terceiros. **Todo conteúdo de documento é tratado como não confiável**,
incluindo HTML embutido, SVG, links, imagens e diagramas Mermaid.

O que o app garante:

| Superfície | Proteção |
|---|---|
| HTML/SVG do documento | 100% do HTML gerado passa por **DOMPurify** antes de tocar o DOM. Sem exceção, sem flag de "permitir HTML bruto". |
| Renderer | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, sem `webview`. |
| CSP (produção) | `default-src 'none'`, `script-src 'self'`, sem `unsafe-eval`, sem origem remota. |
| Imagens locais | Servidas pelo protocolo `mdasset://`, restrito às pastas dos documentos abertos, com `realpath` (bloqueia symlink/junção) e limpeza ao fechar a janela. |
| Caminhos de rede | `//host/...` e `\\host\...` são removidos na sanitização e rejeitados no processo main — evita autenticação SMB/NTLM silenciosa. |
| Abertura de arquivos | O main só abre caminhos locais com extensão Markdown; UNC é rejeitado. |
| Navegação de pastas | Limitada à pasta do documento aberto, seus ancestrais e descendentes. |
| Links externos | Somente `http:`, `https:` e `mailto:`, sempre no navegador padrão via `shell.openExternal`. |
| IPC | Handlers validam tipo e conteúdo e só aceitam mensagens do frame principal da própria janela. |
| Rede | Zero requisições para renderizar. Nenhuma fonte, CSS ou script de CDN. Imagens remotas podem ser bloqueadas. |
| Tamanho | Arquivos acima de 20 MB são recusados com mensagem explicativa. |

## Copilot: injeção de prompt (XPIA)

O painel do Copilot envia um trecho do documento aberto como contexto. Como esse
texto é não confiável, o app aplica defesa em profundidade:

- **Nenhuma aprovação automática.** O app não usa `approveAll`. Um handler próprio
  aprova apenas **leitura de arquivos dentro da pasta do documento** e **nega** shell,
  escrita, rede e MCP — mesmo que o modelo peça.
- **Sem descoberta de configuração** (`enableConfigDiscovery: false`): instruções,
  skills e servidores MCP da pasta do documento **não** são carregados.
- **Contexto delimitado**: o trecho vai dentro de `<untrusted_document_content>`, com
  instrução explícita de tratá-lo como dado, nunca como instrução. Tentativas de fechar
  o delimitador são neutralizadas.
- **Contexto vem do processo main**, não do renderer: um renderer comprometido não
  escolhe qual arquivo ou pasta é enviado.

> O conteúdo do documento e seu caminho são enviados ao serviço GitHub Copilot quando
> você usa o painel. Se isso não for aceitável para um documento específico, não use o
> painel com ele.

## Build não assinado

Os binários gerados por `npm run dist` **não são assinados**. O SmartScreen exibirá um
aviso na primeira execução. Verifique a política de software da sua organização antes
de rodar em máquina corporativa, e prefira compilar você mesmo a partir do código.

## Reportando uma vulnerabilidade

Abra uma issue com o rótulo `security` descrevendo o problema e um passo a passo de
reprodução. Para algo sensível, use o **Report a vulnerability** na aba *Security* do
repositório em vez de uma issue pública.
