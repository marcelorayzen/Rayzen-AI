# Marcelo

> Caderno sobre a pessoa com quem o Rayzen trabalha. **Não é a identidade do agente** — essa é
> `rayzen.soul.md`, ao lado. Aqui não mora fato canônico de projeto: isso fica no Rayzen, e se
> perguntam sobre um projeto, a resposta vem de lá (`rayzen_get_state`, `rayzen_get_context`),
> não daqui.
>
> **Este arquivo é a semente versionada.** O `entrypoint.sh` o copia para
> `~/.hermes/memories/USER.md` **só se ainda não existir**, e nunca por cima: dali em diante o
> Hermes o edita (com `write_approval: true`, em estágio, revisável por `/memory pending`). Os
> dois divergem por desenho — o do repositório é como ele começa, não o que ele é hoje.

> ## ⚠️ Versão pública — redigida de propósito
>
> No repositório privado este arquivo traz o perfil operacional completo: endereço do servidor,
> a lista nominal de projetos e **quais deles são de cliente**.
>
> Nada disso foi publicado, e a razão é a própria promessa que o Rayzen faz: *"respeito a separação
> entre vida pessoal, projetos e clientes"*. Publicar a arquitetura e o nome dos clientes num
> repositório de portfólio contradiria em um commit o que a plataforma inteira existe para
> sustentar — e a separação vale mais quando custa alguma coisa.
>
> **O que a versão pública preserva é o desenho**, que é o que importa para quem lê o código: um
> caderno curado, copiado sem sobrescrever, que declara as próprias lacunas.

## Quem é

- **Marcelo Rayzen** — QA Automation Engineer e desenvolvedor full-stack.
- Fala e escreve **português brasileiro**. Tratado no masculino.
- Constrói o Rayzen como plataforma pessoal, não como produto para terceiros.

## Onde o trabalho acontece

| | |
|---|---|
| Máquina de trabalho | Windows, com o agent desktop rodando e os hooks do Claude Code |
| Servidor | máquina local dedicada, Docker Compose, exposta por Cloudflare Tunnel |
| Canais | web, Telegram e o HUB (Hermes) |

O Telegram tem um grupo vinculado ao projeto Rayzen AI; o chat privado abre no **contexto geral**,
que é deliberado.

## Projetos que existem

Os nomes e descrições vêm do registro do Rayzen, não de memória — e cada projeto declara seu
**domínio** (`pessoal`, `trabalho` ou `cliente`), que acompanha todo trecho indexado até o prompt.

*A lista nominal fica fora da versão pública.* O que o agente precisa saber não é quais são: é
que **existe um domínio declarado por projeto**, que trecho sem marca é projeto não classificado,
e que não se deduz domínio a partir do caminho do arquivo.

**Trabalho de cliente não se mistura com projeto pessoal nem com estudo numa mesma resposta.**

## Como ele trabalha — o que já está demonstrado

Isto não é preferência declarada: é o padrão observável no próprio repositório, e vale como
expectativa até ele dizer o contrário.

- **Mede antes de concluir.** Afirmação sobre estado do sistema vem acompanhada do comando que a
  produziu. "Provavelmente" e "deve estar" não valem como resposta.
- **Cobra sensor, não enunciado.** Regra que não tem mecanismo atrás é considerada não-existente.
  Um teste que nunca ficou vermelho é considerado não-testado.
- **Quer saber o que quebrou.** Erro relatado na hora vale mais que aparência de competência.

## O que eu não sei sobre ele

Esta seção existe para que a lacuna seja **visível em vez de preenchida**. Perguntar é a resposta
certa aqui; deduzir não é.

- Rotina, horários e fuso de trabalho.
- Como ele prefere ser avisado de algo urgente, e o que conta como urgente.
- Quais projetos estão ativos de verdade neste momento e quais só existem no registro.
- Prazos, compromissos e obrigações fora do que está escrito no Rayzen.
- Qualquer coisa sobre vida pessoal, família ou finanças.

Se uma resposta depender de algo desta lista, o certo é dizer o que falta — não completar.
