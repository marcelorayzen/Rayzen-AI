// Detecção de intenção por regex — "simples antes de inteligente" (mesmo
// princípio já declarado em docs/roadmap.md do Rayzen: regra explícita antes
// de ML, regex antes de embedding). Cobre OWN-001/002/003/004/005 do golden
// dataset: perguntas sobre QUEM é responsável por um ativo/domínio são
// metadado administrativo, público mesmo sem acesso ao domínio (ver
// PermissionGuardService.getOwnerOnly() e QueryService.askOwnership()).
// "quem aprovou" fica de fora de propósito: é pergunta de trilha de
// auditoria de mudança (OWN-005), não de responsabilidade pelo ativo — o
// contexto que askOwnership() monta só tem owner, então forçar essa
// pergunta por aqui produzia resposta fora do alvo ("não há responsável
// definido" quando a pergunta era sobre quem aprovou uma mudança). Sem
// trilha de auditoria de metadado implementada ainda (ver roadmap Fase 5),
// o fluxo normal de ask() já responde honestamente "não está documentado".
const OWNERSHIP_PATTERNS = [
  /\bowner\b/i,
  /respons[aá]ve(l|is)/i,
  /\bsteward\b/i,
  /\bencarregado\b/i,
  /quem\s+(e|é)\s+(o|a)\s+(owner|dono|respons[aá]vel|steward)/i,
  /com\s+quem\s+(eu\s+)?falo/i,
]

export function isOwnershipQuestion(text: string): boolean {
  return OWNERSHIP_PATTERNS.some((p) => p.test(text))
}

// Domínios conhecidos hardcoded — mesmo padrão pragmático do resto do app
// nesta fase (ver domainSlug() em openmetadata.adapter.ts). Fase 4/5 deveria
// puxar isso de uma lista viva de domains em vez de um const.
export const KNOWN_DOMAINS = ['vendas', 'marketing', 'produto', 'financeiro', 'rh']

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Retorna o primeiro domínio conhecido mencionado na pergunta (case/acento
// insensitive — "RH", "Rh", "rh" e "recursos humanos" todos devem casar).
export function extractDomainMention(text: string, domains: string[] = KNOWN_DOMAINS): string | null {
  const normalized = stripAccents(text.toLowerCase())
  for (const domain of domains) {
    const pattern = new RegExp(`\\b${domain}\\b`, 'i')
    if (pattern.test(normalized)) return domain
  }
  if (/recursos\s+humanos/.test(normalized)) return 'rh'
  return null
}
