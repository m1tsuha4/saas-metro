import { Module } from '@nestjs/common';
import { WaController } from './wa.controller';
import { WaService } from './wa.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WaGateway } from './wa.gateway';
import { CloudinaryService } from 'src/common/services/cloudinary.service';

@Module({
  controllers: [WaController],
  providers: [WaService, WaGateway, CloudinaryService],
  imports: [PrismaModule],
  exports: [WaService],
})
export class WaModule {}
