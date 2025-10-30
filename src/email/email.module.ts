import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { GoogleEmailService } from './google.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EmailService, GoogleEmailService],
  controllers: [EmailController]
})
export class EmailModule {}
