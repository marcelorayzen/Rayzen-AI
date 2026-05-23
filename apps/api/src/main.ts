import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multipart = require('@fastify/multipart')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helmet = require('@fastify/helmet')

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } })

  const isDev = process.env.NODE_ENV !== 'production'
  await app.register(helmet, {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
    // HSTS: only in prod (requires HTTPS)
    strictTransportSecurity: isDev ? false : { maxAge: 31536000, includeSubDomains: true },
    crossOriginEmbedderPolicy: false, // swagger-ui incompatível com COEP
  })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  const corsEnv = process.env.CORS_ORIGINS ?? 'http://localhost:3100'
  const allowedOrigins = corsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: origin not allowed — ${origin}`), false)
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
    ],
  })

  const config = new DocumentBuilder()
    .setTitle('Rayzen AI API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config))

  const port = process.env.API_PORT ?? 3001
  await app.listen(port, '0.0.0.0')
  console.log(`API running on http://0.0.0.0:${port}`)
  console.log(`Docs: http://0.0.0.0:${port}/docs`)
}

bootstrap()
