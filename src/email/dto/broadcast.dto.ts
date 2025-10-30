import { z } from 'zod';
import { createZodDto } from '@anatine/zod-nestjs';

export const EmailBroadcastSchema = z.object({
  fromEmail: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  recipients: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
  })).min(1),
  delayMs: z.number().int().min(0).default(1000),
  jitterMs: z.number().int().min(0).default(400),
});

export class EmailBroadcastDto extends createZodDto(EmailBroadcastSchema) {}
