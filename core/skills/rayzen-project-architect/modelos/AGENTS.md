# Contrato de trabalho do repositório — {{nome do projeto}}

> Para qualquer agente (Codex, Claude, Hub) e para pessoas. Curto de propósito: o detalhe
> mora nos documentos que este arquivo manda ler.

## Escopo atual

{{O que este repositório entrega HOJE, em 2–4 frases. O que ele ainda NÃO é (ex.: "demo
estática, sem contas nem dados reais").}}

## Antes de alterar

1. Ler `docs/ESTADO-DO-PROJETO.md`, `docs/BACKLOG.md` e o documento do módulo afetado.
2. Preservar a diferença entre decisão aprovada, código, teste automatizado, validação
   humana, deploy e uso operacional — nenhum implica o seguinte.
3. Não inventar {{regras de domínio, medidas, dados de cliente, critérios de liberação}}.
   Registrar a lacuna como `TODO(decisão)` e pedir a definição.
4. Mudança de domínio começa por contrato (`docs/CONTRATO-*.md`) e teste determinístico,
   depois a tela.

## Segurança e operações

- Nunca ler, imprimir, versionar ou pedir que sejam colados valores de `.env*`, tokens,
  senhas ou chaves. `.env.example` só com nomes.
- Não executar {{deploy, migração remota, alteração de DNS, publicação externa, ação sobre
  dados reais}} sem aprovação humana explícita para aquele alvo.
- Notas operacionais, evidências e handoffs ficam em `.local/` (fora do git). Documentação
  pública distingue fato verificado de plano.

## Verificação mínima

{{comando de verificação, ex.: `npm run check`}} e `git diff --check`.

Testes e build provam só o código local; navegador, banco, permissões e deploy se validam
separadamente.
