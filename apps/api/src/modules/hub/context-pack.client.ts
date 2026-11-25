import { BadGatewayException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common'

export type AuthorizedContextPack = { id: string; text: string; snapshotHash: string }

/** Reads a pack as the authenticated human; service credentials never cross this boundary. */
@Injectable()
export class ContextPackClient {
  private readonly baseUrl = process.env.API_V2_URL?.replace(/\/$/, '')

  async content(id: string, authorization: string | undefined): Promise<AuthorizedContextPack> {
    if (!this.baseUrl) throw new ServiceUnavailableException({ code: 'hub_context_not_configured' })
    if (!authorization?.startsWith('Bearer ')) throw new ForbiddenException({ code: 'hub_context_human_auth_required' })
    let response: Response
    try {
      // API V2 keeps its /v2 prefix inside the compose network as well as at
      // the public proxy. The browser issues at /v2/context/packs; this
      // server-to-server read must address that same controller namespace.
      response = await fetch(`${this.baseUrl}/v2/context/packs/${encodeURIComponent(id)}/content`, { headers: { Authorization: authorization } })
    } catch {
      throw new BadGatewayException({ code: 'hub_context_unreachable' })
    }
    if (response.status === 401 || response.status === 403) throw new ForbiddenException({ code: 'hub_context_not_authorized' })
    if (!response.ok) throw new BadGatewayException({ code: 'hub_context_rejected', status: response.status })
    const pack = await response.json() as Partial<AuthorizedContextPack>
    if (pack.id !== id || typeof pack.text !== 'string' || typeof pack.snapshotHash !== 'string') {
      throw new BadGatewayException({ code: 'hub_context_invalid_response' })
    }
    return pack as AuthorizedContextPack
  }
}
