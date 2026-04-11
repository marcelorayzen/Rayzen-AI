import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { WikiCompilationService } from '../wiki-compilation.service'

const mockLlmResponse = {
  title: 'BullMQ Retry Strategy',
  slug: 'bullmq-retry-strategy',
  tags: ['queue', 'redis', 'nestjs'],
  content_md: '## Resumo\nRetry com backoff.\n\n## Detalhes\nUse attempts e backoff.\n\n## Referências\ndocs.bullmq.io',
  related_keywords: ['redis', 'queue'],
}

describe('WikiCompilationService', () => {
  let service: WikiCompilationService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikiCompilationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fb?: string) =>
              ({ LITELLM_BASE_URL: 'http://localhost:4000/v1', LITELLM_MASTER_KEY: 'sk-test' }[key] ?? fb ?? ''),
          },
        },
      ],
    }).compile()
    service = module.get<WikiCompilationService>(WikiCompilationService)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(service as any).llm = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(mockLlmResponse) } }],
          }),
        },
      },
    }
  })

  describe('toSlug', () => {
    it('converts title to kebab-case without accents', () => {
      expect(service.toSlug('BullMQ Retry Strategy')).toBe('bullmq-retry-strategy')
    })

    it('removes accents from Portuguese titles', () => {
      expect(service.toSlug('Configuração de Autenticação')).toBe('configuracao-de-autenticacao')
    })

    it('collapses multiple hyphens', () => {
      expect(service.toSlug('foo  --  bar')).toBe('foo-bar')
    })
  })

  describe('compile', () => {
    it('returns structured draft from LLM', async () => {
      const draft = await service.compile('BullMQ retry docs content', [])

      expect(draft.title).toBe('BullMQ Retry Strategy')
      expect(draft.slug).toBe('bullmq-retry-strategy')
      expect(draft.tags).toContain('queue')
      expect(draft.contentMd).toContain('## Resumo')
      expect(draft.relatedKeywords).toContain('redis')
    })

    it('uses fallback title when LLM returns empty', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(service as any).llm.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: '{}' } }],
      })

      const draft = await service.compile('some content', [])
      expect(draft.title).toBe('Nota sem título')
    })

    it('includes source context in LLM call when sources are provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn((service as any).llm.chat.completions, 'create')

      await service.compile('content', [
        { id: 'doc-1', content: 'source content', sourcePath: 'url/example.com', metadata: {}, score: 0.9 },
      ])

      const callArgs = spy.mock.calls[0][0] as { messages: Array<{ content: string }> }
      const userMessage = callArgs.messages[1].content
      expect(userMessage).toContain('Fontes recuperadas')
    })
  })
})
