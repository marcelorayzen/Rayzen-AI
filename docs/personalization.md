# Rayzen AI — Guia de Personalização

> **Forma recomendada:** use o painel de configurações em `/settings` ou edite diretamente o arquivo `rayzen.config.json` na raiz do projeto. A maioria das personalizações não requer tocar no código.

---

## Início rápido

Abra o painel → ícone ⚙ no header → **Configurações**.

Ou edite diretamente:

```bash
# Na raiz do projeto
rayzen.config.json
```

As mudanças são aplicadas na próxima reinicialização da API (ou imediatamente via painel).

---

## 1. Identidade

**Via painel:** aba **Identidade**

**Via arquivo:**
```json
"identity": {
  "name": "Kai",
  "language": "pt-BR",
  "personality": "Você é direto, técnico e objetivo. Sem frases de abertura genéricas. Respostas concisas. Use markdown quando ajudar a clareza."
}
```

### Exemplos de personalidade

**Técnico / Developer (padrão atual):**
```
Você é direto, técnico e objetivo. Sem frases de abertura genéricas. Respostas concisas. Use markdown quando ajudar a clareza.
```

**Executivo / Formal:**
```
Comunicação formal, clara e objetiva. Priorize praticidade e economia de tempo. Estruture respostas em tópicos quando houver mais de 2 pontos.
```

**Criativo / Descontraído:**
```
Tom leve, use emojis com moderação. Seja encorajador e criativo nas sugestões. Prefira linguagem coloquial e próxima.
```

**Jurídico:**
```
Linguagem formal e precisa. Mencione quando algo requer consulta profissional. Cite bases legais quando relevante. Nunca emita opinião pessoal sobre casos específicos.
```

### Idiomas suportados

| Código | Idioma |
|---|---|
| `pt-BR` | Português brasileiro (padrão) |
| `en-US` | Inglês americano |
| `es-ES` | Espanhol |

---

## 2. Módulos

**Via painel:** aba **Módulos**

**Via arquivo:**
```json
"modules": {
  "brain": true,
  "jarvis": true,
  "doc": true,
  "content": true,
  "tts": true,
  "stt": true
}
```

Defina `false` para desativar. O orquestrador ignora módulos desativados na classificação.

---

## 3. Modelos LLM

**Via painel:** aba **LLM** — slider de temperature + campo de modelo

**Via arquivo:**
```json
"llm": {
  "classify":  { "model": "gpt-4o-mini", "temperature": 0   },
  "chat":      { "model": "gpt-4o",      "temperature": 0.7 },
  "brain":     { "model": "gpt-4o-mini", "temperature": 0.3 },
  "doc":       { "model": "gpt-4o-mini", "temperature": 0.2 },
  "content":   { "model": "gpt-4o",      "temperature": 0.8 },
  "jarvis":    { "model": "gpt-4o",      "temperature": 0.3 }
}
```

Os nomes `gpt-4o` e `gpt-4o-mini` são aliases configurados no LiteLLM (`infra/litellm/config.yaml`). Para trocar o modelo real (ex: de Groq para OpenAI), edite o `config.yaml` — o código não precisa mudar.

---

## 4. PC Agent — ações e sandbox

**Via painel:** aba **Agent**

### Ativar/desativar ações individuais
```json
"agent": {
  "actions": {
    "open_app":   true,
    "git_commit": false,
    "send_email": true
  }
}
```

### Sandbox de diretórios
```json
"sandbox": {
  "paths": [
    "~/Projects",
    "~/Desktop",
    "~/Documents",
    "~/Downloads",
    "D:\\MeusProjetos"
  ]
}
```

### Aplicativos permitidos
```json
"allowedApps": ["code", "chrome", "firefox", "notion", "slack", "spotify"]
```

### Domínios permitidos (open_url)
```json
"allowedDomains": ["youtube.com", "github.com", "google.com", "notion.so"]
```

---

## 5. Segurança — dryRun por ação

**Via painel:** aba **Segurança**

```json
"security": {
  "sendEmailDryRun":         false,
  "gitCommitDryRun":         false,
  "organizeDownloadsDryRun": true,
  "dockerStopDryRun":        false,
  "createProjectDryRun":     false
}
```

`true` = simula sem executar. `false` = executa diretamente.

Recomendação: mantenha `organizeDownloadsDryRun: true` até ter confiança no comportamento.

---

## 6. Voz (TTS)

**Via painel:** aba **Voz**

```json
"tts": {
  "provider": "groq",
  "voice": "daniel"
}
```

### Provider: Groq Orpheus (padrão)

| Voz | Perfil |
|---|---|
| `daniel` | Masculina, neutra |
| `austin` | Masculina, casual |
| `troy` | Masculina, grave |
| `autumn` | Feminina, suave |
| `diana` | Feminina, clara |
| `hannah` | Feminina, expressiva |

> Groq Orpheus v1 gera voz em inglês — sotaque estrangeiro em textos PT-BR.

### Provider: ElevenLabs (PT-BR nativo)

1. Crie conta em **elevenlabs.io**
2. Copie a API Key em **Profile → API Key**
3. Adicione no `.env`:
```bash
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=...
```
4. Mude no config:
```json
"tts": { "provider": "elevenlabs", "voice": "seu-voice-id" }
```
5. Edite `apps/api/src/modules/voice/voice.service.ts` (o `VoiceService` cobre TTS e STT — ElevenLabs entra como provider alternativo do método `synthesize()`) para chamar a API do ElevenLabs (ver seção avançada abaixo).

---

## 7. Indexação do Brain

O Brain armazena memória semântica. Três formas de alimentá-lo:

### GitHub
**Via painel:** ícone ↑ no header → aba **GitHub**

```bash
POST /brain/index/github
{ "username": "seususuario", "token": "ghp_..." }
```

**Token GitHub (para repos privados):**
1. github.com → foto de perfil → **Settings**
2. **Developer settings → Personal access tokens → Tokens (classic)**
3. **Generate new token** → marque `repo` → copie o `ghp_...`

### Arquivo (PDF / TXT)
**Via painel:** ícone ↑ → aba **Arquivo**

Suporta `.pdf` e `.txt`. Ideal para currículo, projetos, anotações.

### URL
**Via painel:** ícone ↑ → aba **URL**

```bash
POST /brain/index/url
{ "url": "https://..." }
```

### Memória automática
Durante conversas, o assistente extrai e indexa automaticamente informações pessoais mencionadas.

---

## 8. Adicionar nova ação ao Agent

Ver [RAYZEN_AGENT_PROTOCOL.md](RAYZEN_AGENT_PROTOCOL.md) para o passo a passo completo.

Resumo:
1. Implemente em `apps/agent/src/actions/nova-acao.ts`
2. Adicione em `apps/agent/src/security/whitelist.ts`
3. Adicione case em `apps/agent/src/executor.ts`
4. Adicione extração de payload em `orchestrator.service.ts`
5. Ative no `rayzen.config.json` → `agent.actions.nova_acao: true`

---

## 9. Configurações avançadas de TTS (ElevenLabs)

> TTS (text-to-speech) é uma das duas funções do `VoiceService` (a outra é STT/transcrição) — não existe um módulo `tts` separado.

```typescript
// apps/api/src/modules/voice/voice.service.ts — método synthesize() do VoiceService
async synthesize(text: string): Promise<Buffer> {
  const clean = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/`(.+?)`/g, '$1')
    .slice(0, 800)

  const voiceId = this.config.get('ELEVENLABS_VOICE_ID')
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': this.config.get('ELEVENLABS_API_KEY') ?? '',
    },
    body: JSON.stringify({
      text: clean,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) throw new Error(`ElevenLabs TTS falhou: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}
```

---

## 10. Rate limiting

```typescript
// apps/api/src/app.module.ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])
// 120 requisições por minuto por IP
```

---

## 11. Checklist de personalização rápida

- [ ] Nome e personalidade → `rayzen.config.json` → `identity` (ou painel → Identidade)
- [ ] Módulos ativos → `rayzen.config.json` → `modules` (ou painel → Módulos)
- [ ] Modelos LLM → `rayzen.config.json` → `llm` (ou painel → LLM)
- [ ] Ações do Agent → `rayzen.config.json` → `agent.actions` (ou painel → Agent)
- [ ] Sandbox de pastas/apps → `rayzen.config.json` → `agent.sandbox`
- [ ] dryRun por ação → `rayzen.config.json` → `agent.security` (ou painel → Segurança)
- [ ] Voz TTS → `rayzen.config.json` → `tts` (ou painel → Voz)
- [ ] Indexar Brain → ícone ↑ no header (GitHub, PDF, URL)
- [ ] Modelos reais (Groq/OpenAI) → `infra/litellm/config.yaml`
