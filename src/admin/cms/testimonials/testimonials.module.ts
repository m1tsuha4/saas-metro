import { Module } from '@nestjs/common';
import { TestimonialsService } from './testimonials.service';
import { TestimonialsController } from './testimonials.controller';
import { PrismaService } from 'src/prisma/prisma.service'; // Sesuaikan path prisma lo

@Module({
  controllers: [TestimonialsController],
  providers: [TestimonialsService, PrismaService],
  exports: [TestimonialsService], // Export kalo mau dipake di modul lain (misal LandingModule)
})
export class TestimonialsModule {}