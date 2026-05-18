# Manual de QA — Rayzen AI

> Guia de uso do sistema de QA integrado ao Rayzen para projetos Java/Selenium, APIs e automações.

---

## Visão geral

O Rayzen AI oferece 3 camadas de suporte a QA:

| Camada | O que faz | Como acionar |
|---|---|---|
| **Execução** (`jarvis:run_tests`) | Roda os testes e retorna resultado | Chat: "rode os testes do projeto X" |
| **Captura de falhas** (`jarvis:capture_test_failure`) | Lê relatórios JUnit, casa screenshots do Selenium, indexa no Brain | Chat: "capture as falhas do último build" |
| **Dashboard QA** | Visualiza histórico, tendência e padrões de falha | Botão QA na interface web |

---

## 1. Executar testes — `jarvis:run_tests`

### Runners suportados

| Runner | Linguagem / Framework | Quando usar |
|---|---|---|
| `maven` | Java + JUnit/TestNG (Maven) | Projetos Maven com `pom.xml` |
| `gradle` | Java + JUnit/TestNG (Gradle) | Projetos Gradle com `build.gradle` |
| `pytest` | Python | Testes Python com pytest |
| `newman` | REST APIs (Postman) | Coleções Postman exportadas como JSON |
| `jest` | Node.js / TypeScript | Projetos JavaScript/TypeScript |
| `vitest` | Node.js / TypeScript | Projetos Vite |
| `playwright` | E2E Web | Testes de browser |

### Como usar no chat

```
# Maven — projeto em Desktop\Projects\meu-projeto
rode os testes do projeto meu-projeto (maven)

# Com filtro (só uma classe/método)
rode os testes maven do projeto meu-projeto, só a classe LoginTest

# Gradle
rode os testes gradle do projeto meu-projeto

# Pytest
rode os testes python em C:\Projects\api-tests

# Newman — coleção Postman
rode a coleção postman em C:\Projects\api\collection.json com environment C:\Projects\api\env.json
```

### Payload completo (para uso via API direta)

```json
{
  "module": "jarvis",
  "action": "run_tests",
  "payload": {
    "projectPath": "C:\\Users\\marce\\Desktop\\Projects\\meu-projeto",
    "runner": "maven",
    "filter": "LoginTest",
    "coverage": true,
    "collectionPath": "C:\\path\\collection.json",
    "environment": "C:\\path\\env.json"
  }
}
```

### O que é retornado

```json
{
  "runner": "maven",
  "total": 42,
  "passed": 38,
  "failed": 3,
  "skipped": 1,
  "durationMs": 12430,
  "failures": [
    {
      "suite": "com.empresa.LoginTest",
      "name": "testLoginInvalidPassword",
      "message": "expected 401 but got 200"
    }
  ]
}
```

---

## 2. Capturar falhas — `jarvis:capture_test_failure`

Esta ação combina 3 coisas:
1. Lê os relatórios JUnit XML (`target/surefire-reports/*.xml` ou `build/test-results/test/*.xml`)
2. Casa automaticamente cada falha com o screenshot do Selenium (por nome do teste)
3. Indexa o conteúdo no Brain do projeto para o Claude consultar em conversas futuras

### Como usar no chat

```
# Depois de rodar os testes Maven que falharam
capture as falhas do build do projeto meu-projeto

# Especificando onde o Selenium salva screenshots
capture as falhas do projeto meu-projeto, screenshots em target/screenshots
```

### Comportamento automático de screenshots

- Se o Selenium salvou screenshots: casa por nome do método (ex: `testLoginInvalido.png` → falha `testLoginInvalido`)
- Se não há screenshots do Selenium: tira um screenshot do sistema (`Pictures\Rayzen\{projeto}\test-failure-{ts}.png`)
- O caminho do screenshot fica registrado no documento indexado — rastreabilidade total

### Onde ficam as screenshots

```
C:\Users\marce\Pictures\Rayzen\
├── meu-projeto\
│   ├── test-failure-2026-05-16T14-30-00.png   ← screenshot automático do sistema
│   └── selenium-failure-2026-05-17T09-15-00.png
└── geral\
    └── screenshot-2026-05-15T10-00-00.png
```

### Conteúdo indexado no Brain

Cada captura cria um documento em `/qa/falhas/{projeto}/{data}`:

```
# Falhas de Teste — 16/05/2026, 14:30

Total de falhas: 3

## FALHA: com.empresa.LoginTest#testLoginInvalidPassword
Mensagem: expected 401 but got 200
Stack:
  at LoginTest.testLoginInvalidPassword(LoginTest.java:45)
Screenshot: C:\Users\marce\Pictures\Rayzen\meu-projeto\test-failure-2026-05-16...
```

Depois disso você pode perguntar no chat: *"quais testes falharam hoje?"* e o Claude responde com base no Brain.

---

## 3. Dashboard QA — painel web

Acesse: https://rayzen-web.vercel.app → selecione o projeto → botão **QA** no header

### Aba Resumo

- Data e resultado do último run (tool, total, passados, falhados, taxa de sucesso)
- Top falhas recorrentes (test + contagem + última ocorrência + mensagens)
- Testes flaky (que falham e passam alternadamente)

### Aba Tendência

Gráfico dos últimos 30 dias:
- Linha de taxa de sucesso (%)
- Barras de total de testes / falhas por dia

### Aba Histórico

Tabela com os 20 últimos runs:
- Data, ferramenta, branch, commit hash
- Total / passou / falhou / pulou
- Duração em ms

### Como popular o dashboard

O dashboard usa os dados enviados ao endpoint `POST /qa/reports/ingest`.
O `jarvis:run_tests` e `jarvis:capture_test_failure` **não enviam automaticamente** para o dashboard — use o `jarvis:parse_test_report` para isso:

```
# Após rodar os testes, indexar o relatório no dashboard
POST /qa/reports/ingest com o XML do surefire
```

Ou via agente:
```
# O Rayzen pode fazer isso automaticamente após cada run — configure o projectId
indexe o relatório de testes do build no dashboard QA
```

---

## 4. Fluxo completo — exemplo prático (Java + Selenium)

```
1. Abrir o projeto no VS Code
   → hook envia eventos para o Brain

2. Rodar os testes:
   "rode os testes maven do projeto selenium-tests"

3. Se houver falhas, capturar:
   "capture as falhas do build selenium-tests"
   → relatórios XML lidos
   → screenshots do Selenium casados com as falhas
   → tudo indexado no Brain

4. Perguntar ao Claude sobre as falhas:
   "quais testes falharam? é problema de ambiente ou de código?"
   → Claude consulta o Brain e responde com base nos dados reais

5. Ver histórico no Dashboard QA:
   → https://rayzen-web.vercel.app → projeto → botão QA
   → aba Histórico mostra todos os runs anteriores

6. Identificar testes instáveis:
   → aba Resumo → seção "Testes Flaky"

7. Consultar evidências manuais:
   → na aba **Documentação**, abrir **Evidências de teste**
   → o documento consolida screenshots manuais do projeto com descrição, data e link
```

---

## 5. Integração com o Brain — dicas

- **Indexar o código de testes**: no painel Brain, indexe o repositório do projeto de QA via GitHub para o Claude entender o que cada teste faz
- **Indexar documentação de ambiente**: suba docs do ambiente de QA (URLs, credenciais de teste, dependências) para o Brain
- **Checkpoint após cada ciclo de QA**: use o botão "checkpoint" na interface para registrar o que foi feito, o que falhou e o que foi corrigido
- **Perguntas úteis no chat**:
  - *"Quais testes falharam mais vezes esta semana?"*
  - *"O teste LoginTest tem falhado por problemas de ambiente ou de lógica?"*
  - *"Sugira melhorias para os testes baseado nas falhas recentes"*

---

## 6. Configuração por projeto

Para usar QA em um novo projeto, no `hook.config.mjs` garanta que `projectId` aponta para o projeto correto (ver seção Rayzen AI em `CLAUDE.md`).

Para projetos Java, certifique-se de que:
- Maven: relatórios em `target/surefire-reports/` (padrão do Surefire plugin)
- Gradle: relatórios em `build/test-results/test/` (padrão do Gradle test)
- Selenium screenshots: configurados para salvar em `target/screenshots/` ou similar

---

## 7. Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `run_tests` retorna 0 testes | Caminho errado ou testes não compilados | Verificar `projectPath`; rodar `mvn compile test-compile` antes |
| Nenhuma falha capturada mesmo com erro | Relatórios XML não gerados | Verificar se Surefire/JUnit gerou os arquivos em `target/surefire-reports` |
| Screenshots não casam com falhas | Nome do arquivo diferente do método de teste | Configurar o Selenium para salvar com o nome exato do método; ou informar `screenshotDir` manualmente |
| Dashboard QA vazio | Relatórios não ingeridos | Usar `POST /qa/reports/ingest` ou `jarvis:parse_test_report` |
| Brain não responde sobre falhas | `capture_test_failure` não foi rodado ou `projectId` errado | Rodar a captura com o `projectId` correto do projeto ativo |
