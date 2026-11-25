/** Identidade já verificada pelo guard; nunca derivada de campos do body/query. */
export interface RayzenPrincipal {
  id: string
  type: 'human' | 'service'
}

export type RequestWithPrincipal = {
  headers: Record<string, string | undefined>
  rayzenPrincipal?: RayzenPrincipal
}
