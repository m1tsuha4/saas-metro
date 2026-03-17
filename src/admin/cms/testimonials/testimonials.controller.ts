import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Delete, 
  Patch, 
  Query, 
  UsePipes 
} from '@nestjs/common';
import { TestimonialsService } from './testimonials.service';
import { CreateTestimonialDto } from './dto/create-testimonial.dto';
import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { TestimonialStatus } from '@prisma/client';

@Controller('cms/testimonials')
@UsePipes(ZodValidationPipe) // Penting: Biar Zod nge-validasi Body otomatis
export class TestimonialsController {
  constructor(private readonly testimonialsService: TestimonialsService) {}

  // Buat testimonial baru (dari Modal di Figma)
  @Post()
  create(@Body() dto: CreateTestimonialDto) {
    return this.testimonialsService.create(dto);
  }

  // Ambil semua data (untuk tabel Admin)
  @Get()
  findAll() {
    return this.testimonialsService.findAll();
  }

  // Ambil data statistik (untuk kotak-kotak di atas & grafik)
  @Get('stats')
  getStats() {
    return this.testimonialsService.getStats();
  }

  // Khusus untuk Landing Page (dengan filter & limit)
  @Get('landing')
  getLanding(
    @Query('limit') limit: string, 
    @Query('minRating') minRating: string
  ) {
    return this.testimonialsService.getForLandingPage(
      limit ? parseInt(limit) : 6,
      minRating ? parseInt(minRating) : 4,
    );
  }

  // Update status (misal dari PENDING ke PUBLISHED)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string, 
    @Body('status') status: TestimonialStatus
  ) {
    return this.testimonialsService.updateStatus(id, status);
  }

  // Hapus testimonial (tombol tempat sampah di Figma)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.testimonialsService.remove(id);
  }
}