import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

export const CreatePackageSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().default('IDR'),
  duration: z.number().min(1).default(30),
  maxContacts: z.number().default(100),
  maxWaBroadcast: z.number().default(500),
  maxEmailBroadcast: z.number().default(1000),
  maxWaSessions: z.number().default(1),
  maxGmailAccounts: z.number().default(1),
  features: z.array(z.string()).optional(),
  isPopular: z.boolean().default(false),
  urutan_ke: z.number().default(0),
});

export class CreatePackageDto extends createZodDto(CreatePackageSchema) {}

export const UpdatePackageSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  duration: z.number().min(1).optional(),
  maxContacts: z.number().optional(),
  maxWaBroadcast: z.number().optional(),
  maxEmailBroadcast: z.number().optional(),
  maxWaSessions: z.number().optional(),
  maxGmailAccounts: z.number().optional(),
  features: z.array(z.string()).optional(),
  isPopular: z.boolean().optional(),
  urutan_ke: z.number().optional(),
  isActive: z.boolean().optional(),
});

export class UpdatePackageDto extends createZodDto(UpdatePackageSchema) {}
