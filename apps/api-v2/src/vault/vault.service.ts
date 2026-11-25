import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { PrismaV2Service } from '../core/prisma-v2.service'

const ALGORITHM = 'aes-256-gcm'

export interface VaultEntry {
  key:       string
  encrypted: string
  createdAt: string
  updatedAt: string
}

interface VaultFile {
  projectSlug: string
  version:     number
  entries:     VaultEntry[]
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name)
  private readonly vaultDir: string
  private readonly masterKey: Buffer

  constructor(private readonly prisma: PrismaV2Service) {
    this.vaultDir = resolve(process.env.VAULT_DIR ?? '/app/vault')
    const hex = process.env.VAULT_MASTER_KEY ?? ''
    if (!hex || hex.length !== 64) {
      this.logger.warn('VAULT_MASTER_KEY not set or invalid — vault disabled (use 32-byte hex string)')
    }
    this.masterKey = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(32)
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted]).toString('base64')
  }

  private decrypt(stored: string): string {
    const buf = Buffer.from(stored, 'base64')
    const iv  = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  }

  private vaultPath(projectSlug: string): string {
    const safe = projectSlug.replace(/[^a-zA-Z0-9_-]/g, '-')
    return resolve(this.vaultDir, `${safe}.enc`)
  }

  private async loadVault(projectSlug: string): Promise<VaultFile> {
    const path = this.vaultPath(projectSlug)
    if (!existsSync(path)) return { projectSlug, version: 1, entries: [] }
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as VaultFile
  }

  private async saveVault(vault: VaultFile): Promise<void> {
    await mkdir(this.vaultDir, { recursive: true })
    const path = this.vaultPath(vault.projectSlug)
    await writeFile(path, JSON.stringify(vault, null, 2), 'utf-8')
  }

  async set(projectSlug: string, key: string, value: string): Promise<void> {
    if (!key.match(/^[a-zA-Z0-9_-]+$/)) {
      throw new BadRequestException('Key must be alphanumeric with _ or -')
    }
    const vault = await this.loadVault(projectSlug)
    const existing = vault.entries.find((e) => e.key === key)
    const now = new Date().toISOString()

    if (existing) {
      existing.encrypted = this.encrypt(value)
      existing.updatedAt = now
    } else {
      vault.entries.push({ key, encrypted: this.encrypt(value), createdAt: now, updatedAt: now })
    }

    await this.saveVault(vault)
  }

  async get(projectSlug: string, key: string, accessor = 'api'): Promise<string> {
    const vault = await this.loadVault(projectSlug)
    const entry = vault.entries.find((e) => e.key === key)
    if (!entry) throw new NotFoundException(`Secret '${key}' not found in vault '${projectSlug}'`)

    // Audit log
    void this.prisma.vaultAccessLog.create({
      data: { projectSlug, key, accessor },
    }).catch(() => null)

    return this.decrypt(entry.encrypted)
  }

  async has(projectSlug: string, key: string): Promise<boolean> {
    const vault = await this.loadVault(projectSlug)
    return vault.entries.some((e) => e.key === key)
  }

  async list(projectSlug: string): Promise<Array<{ key: string; createdAt: string; updatedAt: string }>> {
    const vault = await this.loadVault(projectSlug)
    return vault.entries.map(({ key, createdAt, updatedAt }) => ({ key, createdAt, updatedAt }))
  }

  async delete(projectSlug: string, key: string): Promise<void> {
    const vault = await this.loadVault(projectSlug)
    const before = vault.entries.length
    vault.entries = vault.entries.filter((e) => e.key !== key)
    if (vault.entries.length === before) throw new NotFoundException(`Secret '${key}' not found`)
    await this.saveVault(vault)
  }

  // Resolves vault:// references in a skill input object
  // Returns the resolved input — values are never logged
  async resolve(
    input: Record<string, unknown>,
    defaultProjectSlug: string,
    accessor = 'skill-engine',
  ): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === 'string' && v.startsWith('vault://')) {
        const [, project, key] = v.match(/^vault:\/\/([^/]+)\/(.+)$/) ?? []
        if (project && key) {
          resolved[k] = await this.get(project, key, accessor)
        } else if (key) {
          resolved[k] = await this.get(defaultProjectSlug, key, accessor)
        } else {
          resolved[k] = v
        }
      } else {
        resolved[k] = v
      }
    }
    return resolved
  }

  async getAuditLog(projectSlug: string, limit = 50) {
    return this.prisma.vaultAccessLog.findMany({
      where: { projectSlug },
      orderBy: { accessedAt: 'desc' },
      take: limit,
    })
  }
}
