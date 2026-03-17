import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';
import { TestimonialStatus } from '@prisma/client';

// 1. Definisikan Skema Zod-nya
export const CreateTestimonialSchema = z.object({
  customerName: z.string().min(1, 'Nama customer wajib diisi'),
  businessName: z.string().min(1, 'Nama bisnis wajib diisi'),
  businessType: z.string().min(1, 'Tipe bisnis wajib diisi'),
  location: z.string().optional().nullable(),
  rating: z.number().int().min(1).max(5),
  quote: z.string().min(1, 'Testimonial quote tidak boleh kosong'),
  avatarUrl: z.string().url().optional().nullable(),
  status: z.nativeEnum(TestimonialStatus).default(TestimonialStatus.PENDING),
  isFeatured: z.boolean().default(false),
});

// 2. Buat Class DTO-nya dari Skema di atas
export class CreateTestimonialDto extends createZodDto(CreateTestimonialSchema) {}