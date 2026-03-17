import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service'; // Pastiin path ke prisma service lo bener
import { CreateTestimonialDto } from './dto/create-testimonial.dto';

@Injectable()
export class TestimonialsService {
  constructor(private prisma: PrismaService) {}

  // 1. Simpan testimoni baru
  async create(dto: CreateTestimonialDto) {
    return this.prisma.testimonial.create({
      data: dto,
    });
  }

  // 2. Ambil semua data buat tabel di Dashboard Admin
  async findAll() {
    return this.prisma.testimonial.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // 3. Logic untuk kotak statistik & bar distribusi rating (Figma image_2fb9da)
  async getStats() {
    // Ambil agregasi untuk total dan rata-rata rating
    const aggregate = await this.prisma.testimonial.aggregate({
      _count: { id: true },
      _avg: { rating: true },
    });

    // Hitung per status
    const publishedCount = await this.prisma.testimonial.count({
      where: { status: 'PUBLISHED' },
    });

    const pendingCount = await this.prisma.testimonial.count({
      where: { status: 'PENDING' },
    });

    // Grouping buat bar kuning (Rating Distribution) di Figma
    const distribution = await this.prisma.testimonial.groupBy({
      by: ['rating'],
      _count: { rating: true },
    });

    return {
      total: aggregate._count.id,
      published: publishedCount,
      pending: pendingCount,
      averageRating: aggregate._avg.rating ? parseFloat(aggregate._avg.rating.toFixed(1)) : 0,
      ratingDistribution: distribution,
    };
  }

  // 4. Logic Landing Page: Sesuai "Landing Page Settings" di Figma
  async getForLandingPage(limit: number = 6, minRating: number = 4) {
    return this.prisma.testimonial.findMany({
      where: {
        status: 'PUBLISHED',
        isFeatured: true, // Hanya yang dipilih admin via toggle
        rating: { gte: minRating }, // Filter rating minimal
      },
      take: limit, // Maksimal yang tampil (Max Visible on Page)
      orderBy: { createdAt: 'desc' },
    });
  }

  // 5. Update Status (buat tombol Publish/Archive di tabel)
  async updateStatus(id: string, status: any) {
    return this.prisma.testimonial.update({
      where: { id },
      data: { status },
    });
  }

  // 6. Hapus Testimoni
  async remove(id: string) {
    const exists = await this.prisma.testimonial.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Testimonial tidak ditemukan');
    
    return this.prisma.testimonial.delete({ where: { id } });
  }
}