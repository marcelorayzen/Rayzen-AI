import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ValidationPipe } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app.module'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helmet = require('@fastify/helmet')

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  const isDev = process.env.NODE_ENV !== 'production'
  await app.register(helmet, {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
    strictTransportSecurity: isDev ? false : { maxAge: 31536000, includeSubDomains: true },
    crossOriginEmbedderPolicy: false,
  })

  app.useWebSocketAdapter(new WsAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const corsEnv = process.env.CORS_ORIGINS ?? 'http://localhost:3100'
  const allowedOrigins = corsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true)
      else callback(new Error(`CORS: origin not allowed — ${origin}`), false)
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  })

  // Todas as rotas sob /v2 para coexistência com V1
  app.setGlobalPrefix('v2')

  const config = new DocumentBuilder()
    .setTitle('Rayzen AI V2')
    .setDescription('Mission Oriented Engineering System')
    .setVersion('2.0')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('v2/docs', app, SwaggerModule.createDocument(app, config))

  const port = process.env.API_V2_PORT ?? 3002
  await app.listen(port, '0.0.0.0')
  console.log(`API V2 running on http://0.0.0.0:${port}/v2`)
  console.log(`Docs: http://0.0.0.0:${port}/v2/docs`)
}

bootstrap()
