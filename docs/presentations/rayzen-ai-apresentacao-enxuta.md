# Rayzen AI — apresentação enxuta

## Slide 1 — Capa
### Rayzen AI
**Plataforma de inteligência operacional para projetos de tecnologia**

Memória, execução segura, documentação viva e evidências de QA em um único fluxo.

---

## Slide 2 — O problema
### Projetos perdem contexto ao longo do tempo

- Decisões ficam presas em conversas.
- Documentação envelhece.
- Erros resolvidos não viram aprendizado.
- Evidências de teste se dispersam.
- Retomar um projeto depois de uma pausa custa caro.

**Pergunta central:**  
Como transformar trabalho disperso em contexto contínuo e reutilizável?

---

## Slide 3 — A solução
### Uma plataforma centrada em projeto

O Rayzen AI:
- captura eventos reais;
- organiza memória;
- sintetiza o estado do projeto;
- recomenda próximos passos;
- executa ações autorizadas;
- documenta o que foi feito.

Tudo fica ligado ao projeto correto.

---

## Slide 4 — Como funciona
### Quatro pilares integrados

**Memória**  
Documentos, conversas, eventos e embeddings por projeto.

**Execução**  
Agents autorizados para ações locais e operações da infraestrutura.

**Documentação**  
Estado atual, decisões, retomada, diário e evidências.

**QA**  
Testes, falhas, screenshots, classificação e histórico.

---

## Slide 5 — Arquitetura
### Infraestrutura central + execução distribuída

**VPS**
- Web;
- API;
- PostgreSQL + pgvector;
- Redis + BullMQ;
- LiteLLM;
- Server Agent.

**PC de trabalho**
- Desktop Agent;
- screenshots;
- testes;
- ações locais.

**Mensagem-chave:**  
Cada componente opera no lugar certo, sem misturar projetos nem ampliar permissões desnecessárias.

---

## Slide 6 — IA aplicada com arquitetura
### Mais do que conversar com um modelo

- modelos especializados por função;
- LiteLLM desacoplando providers;
- classificação de intenção;
- busca semântica;
- síntese e documentação;
- MCP expondo ferramentas locais de forma controlada.

**Ideia central:**  
IA útil depende de contexto correto, memória confiável e ação governada.

---

## Slide 7 — Evidências e QA
### Do print solto ao artefato rastreável

Exemplo:
“tire um print da tela: teste de API 52”

O Rayzen:
- salva no projeto correto;
- usa a descrição no nome do arquivo;
- envia para a API;
- classifica a evidência;
- exibe no web;
- alimenta a documentação de testes.

---

## Slide 8 — Documentação viva
### O sistema transforma atividade em conhecimento útil

Gera:
- estado atual;
- resumo de sessão;
- decisões;
- próximos passos;
- diário;
- evidências de teste.

**Resultado:**  
retomar um projeto passa a exigir leitura de contexto, não reconstrução mental.

---

## Slide 9 — Segurança e operação
### Agents por papel

**Desktop Agent**
- screenshot;
- apps;
- clipboard;
- testes locais.

**Server Agent**
- logs;
- Docker;
- restart de serviços.

**Proteções**
- whitelist;
- bloqueio de path traversal;
- diretórios sensíveis protegidos;
- confirmação em ações de maior risco.

---

## Slide 10 — Valor gerado
### Para desenvolvimento e QA

**Desenvolvimento**
- menos tempo perdido;
- melhor retomada;
- decisões preservadas;
- execução assistida.

**QA**
- mais evidência;
- mais rastreabilidade;
- documentação de testes;
- melhor leitura de falhas e padrões.

---

## Slide 11 — Evolução do projeto
### De assistente para plataforma operacional

**Antes**
- backend dependente do notebook;
- Agent único;
- evidências soltas.

**Agora**
- stack em VPS;
- Agents separados por papel;
- projetos isolados;
- evidências integradas ao fluxo de QA;
- operação mais estável e auditável.

---

## Slide 12 — Fechamento
### Rayzen AI

Não é apenas um chatbot.

É uma plataforma para:
- pensar melhor;
- organizar melhor;
- testar melhor;
- documentar melhor;
- executar com mais clareza.
