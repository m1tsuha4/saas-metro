import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { WinstonLoggerService } from './common/services/winston-logger.service';
import { LoggingMiddleware } from './common/middlewares/logging.middleware';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { WaController } from './wa/wa.controller';
import { WaService } from './wa/wa.service';
import { WaModule } from './wa/wa.module';
import { EmailModule } from './email/email.module';
@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    UserModule,
    AuthModule,
    WaModule,
    EmailModule,
  ],
  controllers: [AppController, WaController],
  providers: [AppService, WinstonLoggerService, WaService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
