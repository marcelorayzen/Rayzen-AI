// QA-CHECKLIST.md § 12 "LGPD legal/regulatório" — reusa a mesma tag bruta do
// catálogo fonte já exposta pelo backlog "qualidade via tags" (item 2), mas
// com um filtro DETERMINÍSTICO em código, num bloco próprio do prompt — não
// deixa o LLM disambiguar "LegalBasis.X" dentro da lista solta de tags de
// qualidade (risco de confundir com Certification.*/Tier.*).
const LEGAL_BASIS_PREFIX = 'LegalBasis.'

export function extractLegalBasis(tags: string[]): string[] {
  return tags.filter((t) => t.startsWith(LEGAL_BASIS_PREFIX)).map((t) => t.slice(LEGAL_BASIS_PREFIX.length))
}
