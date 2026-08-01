// QA-CHECKLIST.md § 12 "Processo/política" — mesmo princípio de
// ownership-question.util.ts (regex antes de embedding pra intenção de
// rota, não de conteúdo). Cobre PRO-001..004 do golden dataset: pedido de
// acesso, processo de cadastro, alçada de aprovação, localização de política.
//
// Checado DEPOIS de isOwnershipQuestion() em QueryService.ask() — preserva
// o comportamento/testes já existentes. Caso de borda aceito, não
// resolvido: "quem é responsável por aprovar isso?" ainda cai em
// ownership (tem "responsável"), não em processo — mesmo padrão de
// trade-off já documentado em ownership-question.util.ts pro "quem aprovou".
const PROCESS_PATTERNS = [
  /como\s+(eu\s+)?(pe[çc]o|solicito)/i,
  /qual\s+(o|é\s+o)\s+processo/i,
  /quem\s+aprova\b/i,
  /onde\s+(est[aá]|fica)\s+a\s+pol[ií]tica/i,
]

export function isProcessQuestion(text: string): boolean {
  return PROCESS_PATTERNS.some((p) => p.test(text))
}
