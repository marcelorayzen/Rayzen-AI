import OpenAI from 'openai'

/**
 * Cliente LiteLLM da V1, com o chamador identificado no Langfuse.
 *
 * A V2 manda `metadata.trace_name` em toda chamada e por isso aparece nomeada
 * (`rayzen:benchmark:geracao`, `rayzen:specialist:reviewer`). A V1 não mandava
 * nada: em 2026-08-14, numa janela de 2h, 26 dos 31 traces eram
 * `litellm-acompletion` sem dono — todos com `User-Agent: OpenAI/JS 4.104.0`,
 * ou seja, todos daqui. E a V1 é o app de uso diário.
 *
 * A instrumentação vive no `fetch` do cliente, não nas chamadas: são 25 pontos
 * de `chat.completions.create` espalhados por 11 serviços, e injetar em cada um
 * seria 25 chances de esquecer — inclusive na próxima chamada que alguém
 * escrever. Aqui basta construir o cliente com o nome do módulo.
 */
export function createLlmClient(modulo: string, cfg: { apiKey: string; baseURL: string }): OpenAI {
  return new OpenAI({
    apiKey:  cfg.apiKey,
    baseURL: cfg.baseURL,
    fetch:   (url, init) => fetch(url as RequestInfo, injetarTrace(modulo, url, init)),
  })
}

/**
 * Acrescenta `metadata.trace_name` ao corpo, sem tocar em mais nada.
 *
 * Restrito a `/chat/completions` de propósito: embeddings passam pelo mesmo
 * cliente e não há ganho em nomeá-los, enquanto mandar campo desconhecido para
 * um endpoint que talvez não o aceite arriscaria quebrar indexação de memória
 * por uma questão de observabilidade. Trocar risco de quebra por rótulo é mau
 * negócio.
 *
 * Metadata já presente é respeitada — quem foi explícito no call site sabe mais
 * que o default do módulo.
 */
function injetarTrace(modulo: string, url: unknown, init?: RequestInit): RequestInit | undefined {
  if (!init || typeof init.body !== 'string') return init
  if (!String(url).includes('/chat/completions')) return init

  try {
    const body = JSON.parse(init.body) as Record<string, unknown>
    const meta = (body.metadata ?? {}) as Record<string, unknown>
    if (meta.trace_name) return init

    body.metadata = {
      ...meta,
      trace_name: `rayzen:v1:${modulo}`,
      tags:       [`v1:${modulo}`],
    }

    const novoBody = JSON.stringify(body)

    // O SDK declara `content-length` explicitamente no header. Injetar metadata
    // aumenta o corpo, e sem corrigir esse número o servidor lê só os bytes
    // anunciados, recebe JSON truncado e fica esperando o resto que nunca vem:
    // a chamada pendura até o timeout, sem erro em lugar nenhum. Foi o que
    // aconteceu em produção em 2026-08-15.
    //
    // `Buffer.byteLength`, não `.length` — prompts em português têm acentos, e
    // contar caracteres em vez de bytes recria o mesmo bug em escala menor.
    const headers = { ...(init.headers as Record<string, string> | undefined) }
    for (const chave of Object.keys(headers)) {
      if (chave.toLowerCase() === 'content-length') headers[chave] = String(Buffer.byteLength(novoBody))
    }

    return { ...init, body: novoBody, headers }
  } catch {
    // Corpo que não é JSON não é chamada nossa de chat — segue intacto.
    return init
  }
}
