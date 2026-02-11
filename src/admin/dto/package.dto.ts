import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

// Enum untuk fitur yang tersedia (developer tambah di sini kalau ada module baru)
export const PackageFeatureEnum = z.enum([
  'whatsapp_chat_console',
  'email_chat_console',
  'ai_training_config',
  'broadcast_scheduling',
]);

export type PackageFeature = z.infer<typeof PackageFeatureEnum>;

// Enum untuk billing cycle
export const BillingCycleEnum = z.enum(['monthly', 'yearly']);

export type BillingCycle = z.infer<typeof BillingCycleEnum>;

// Schema untuk create package
export const CreatePackageSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().min(0),
  currency: z.string().default('IDR'),
  billingCycle: BillingCycleEnum,
  features: z.array(PackageFeatureEnum).optional(),
});

export class CreatePackageDto extends createZodDto(CreatePackageSchema) { }

// Schema untuk update package
export const UpdatePackageSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  billingCycle: BillingCycleEnum.optional(),
  features: z.array(PackageFeatureEnum).optional(),
  isActive: z.boolean().optional(),
});

export class UpdatePackageDto extends createZodDto(UpdatePackageSchema) { }
