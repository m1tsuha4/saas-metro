import { Module } from '@nestjs/common';
import { WaController } from './wa.controller';
import { WaService } from './wa.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [WaController],
  providers: [WaService],
  imports: [PrismaModule],
  exports: [WaService],
})
export class WaModule {}
