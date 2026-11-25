import { createHmac, timingSafeEqual } from 'crypto'

/**
 * TOTP (RFC 6238) — a prova humana de aprovação pelo Hub (13/11).
 *
 * ── Por que um segundo fator, e não o login ─────────────────────────────────
 * O `AGENT_TOKEN` é um JWT da mesma família do login da web, e o guard global aceita os dois.
 * Aprovar com "qualquer sessão válida" deixaria o agent aprovar o próprio envelope — a separação
 * da Fase 5-A desfeita por outra porta. O código de 6 dígitos vem de um segredo que existe só no
 * servidor e no celular do Marcelo; o agent não tem como produzi-lo.
 *
 * Escrito à mão (SHA-1, 30 s, 6 dígitos — o padrão de todo app autenticador) para não trazer
 * dependência nova ao caminho de autorização. Validado contra os vetores da própria RFC.
 */

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const PASSO_SEGUNDOS = 30

export function base32ParaBytes(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let valor = 0
  const saida: number[] = []
  for (const c of limpo) {
    const i = ALFABETO_BASE32.indexOf(c)
    if (i < 0) throw new Error('segredo TOTP fora do alfabeto base32')
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(saida)
}

/** HOTP (RFC 4226) com truncamento dinâmico. `digitos` só passa de 6 nos vetores de teste. */
export function hotp(segredo: Buffer, contador: number, digitos = 6): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(contador))
  const h = createHmac('sha1', segredo).update(msg).digest()
  const o = h[h.length - 1] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digitos).padStart(digitos, '0')
}

/**
 * Devolve o PASSO (contador) que casou, ou `null`. Janela de ±1 passo para tolerar relógio
 * de celular levemente fora — mais que isso amplia a superfície de chute sem ganho real.
 *
 * Quem chama guarda o último passo aceito e recusa repetição: sem isso, um código visto por
 * cima do ombro valeria por até 90 s.
 */
export function verificarTotp(segredoBase32: string, codigo: string, agoraMs = Date.now(), janela = 1): number | null {
  if (!/^\d{6}$/.test(codigo)) return null
  const segredo = base32ParaBytes(segredoBase32)
  const atual = Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS)
  const recebido = Buffer.from(codigo)
  for (let d = -janela; d <= janela; d++) {
    const esperado = Buffer.from(hotp(segredo, atual + d))
    if (timingSafeEqual(esperado, recebido)) return atual + d
  }
  return null
}
