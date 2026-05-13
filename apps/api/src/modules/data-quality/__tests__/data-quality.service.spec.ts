import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { DataQualityService } from '../data-quality.service'
import { PrismaService } from '../../../prisma/prisma.service'

const mockPrisma = {
  dataQualityRule: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  dataQualityResult: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  schemaSnapshot: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
}

const rule = (overrides = {}) => ({
  id: 'r1',
  projectId: 'p1',
  dataset: 'users',
  field: 'email',
  ruleType: 'not_null',
  severity: 'critical',
  active: true,
  definition: {},
  createdAt: new Date(),
  ...overrides,
})

describe('DataQualityService', () => {
  let service: DataQualityService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataQualityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get(DataQualityService)
  })

  // ── createRule ────────────────────────────────────────────
  describe('createRule', () => {
    it('creates a rule with defaults', async () => {
      mockPrisma.dataQualityRule.create.mockResolvedValue(rule())
      const result = await service.createRule({ dataset: 'users', ruleType: 'not_null' })
      expect(result.ruleType).toBe('not_null')
      expect(mockPrisma.dataQualityRule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'warning' }) }),
      )
    })
  })

  // ── deleteRule ────────────────────────────────────────────
  describe('deleteRule', () => {
    it('soft-deletes via active=false', async () => {
      mockPrisma.dataQualityRule.findUnique.mockResolvedValue(rule())
      mockPrisma.dataQualityRule.update.mockResolvedValue({ ...rule(), active: false })
      await service.deleteRule('r1')
      expect(mockPrisma.dataQualityRule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      )
    })

    it('throws NotFoundException when rule not found', async () => {
      mockPrisma.dataQualityRule.findUnique.mockResolvedValue(null)
      await expect(service.deleteRule('missing')).rejects.toThrow(NotFoundException)
    })
  })

  // ── computeDatasetScore ───────────────────────────────────
  describe('computeDatasetScore', () => {
    it('returns score=null when no rule has been executed (not_run)', async () => {
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([rule()])
      mockPrisma.dataQualityResult.findFirst.mockResolvedValue(null) // never run

      const [result] = await service.computeDatasetScore('p1')

      expect(result.score).toBeNull()
      expect(result.notRun).toBe(1)
      expect(result.failing).toBe(0)
      expect(result.detail[0].status).toBe('not_run')
      expect(result.detail[0].passed).toBeNull()
    })

    it('returns correct score when all rules pass', async () => {
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([
        rule({ id: 'r1', severity: 'critical' }),
        rule({ id: 'r2', severity: 'warning' }),
      ])
      mockPrisma.dataQualityResult.findFirst
        .mockResolvedValueOnce({ score: 1.0, passed: true, checkedAt: new Date() })
        .mockResolvedValueOnce({ score: 1.0, passed: true, checkedAt: new Date() })

      const [result] = await service.computeDatasetScore('p1')

      expect(result.score).toBe(100)
      expect(result.notRun).toBe(0)
      expect(result.failing).toBe(0)
      expect(result.detail.every(d => d.status === 'passed')).toBe(true)
    })

    it('does NOT treat failing rule as passing (no false confidence)', async () => {
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([
        rule({ id: 'r1', severity: 'critical' }),
      ])
      mockPrisma.dataQualityResult.findFirst.mockResolvedValue({
        score: 0.2,
        passed: false,
        checkedAt: new Date(),
      })

      const [result] = await service.computeDatasetScore('p1')

      expect(result.score).toBe(20)
      expect(result.failing).toBe(1)
      expect(result.detail[0].status).toBe('failed')
    })

    it('does NOT include not_run rules in weighted average', async () => {
      // one run (passing), one not_run — should give 100 not inflated
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([
        rule({ id: 'r1', severity: 'critical' }),
        rule({ id: 'r2', severity: 'critical' }),
      ])
      mockPrisma.dataQualityResult.findFirst
        .mockResolvedValueOnce({ score: 1.0, passed: true, checkedAt: new Date() })
        .mockResolvedValueOnce(null) // r2 never run

      const [result] = await service.computeDatasetScore('p1')

      expect(result.score).toBe(100) // only r1 counts
      expect(result.notRun).toBe(1)
    })
  })

  // ── getSummary ────────────────────────────────────────────
  describe('getSummary', () => {
    it('returns avgScore=null when no rules have been run', async () => {
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([rule()])
      mockPrisma.dataQualityResult.findFirst.mockResolvedValue(null)
      mockPrisma.dataQualityRule.count.mockResolvedValue(1)

      const summary = await service.getSummary('p1')

      expect(summary.avgScore).toBeNull()
      expect(summary.totalNotRun).toBe(1)
    })

    it('returns avgScore=null when no datasets', async () => {
      mockPrisma.dataQualityRule.findMany.mockResolvedValue([])
      mockPrisma.dataQualityRule.count.mockResolvedValue(0)

      const summary = await service.getSummary('p1')

      expect(summary.avgScore).toBeNull()
      expect(summary.datasets).toHaveLength(0)
    })
  })
})
