import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

const helmet = require('@fastify/helmet')

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  const isDev = process.env.NODE_ENV !== 'production'
  await app.register(helmet, {
    contentSecurityPolicy: isDev ? false : undefined,
    crossOriginEmbedderPolicy: false,
  })

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder()
    .setTitle('Catalog Guardian')
    .setDescription('Governança, segurança e resposta em linguagem natural sobre um catálogo de dados existente')
    .setVersion('0.0.1')
    .build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config))

  const port = process.env.PORT ?? 4001
  await app.listen(port, '0.0.0.0')
  console.log(`Catalog Guardian rodando em http://0.0.0.0:${port}`)
  console.log(`Docs: http://0.0.0.0:${port}/docs`)
}

bootstrap()
