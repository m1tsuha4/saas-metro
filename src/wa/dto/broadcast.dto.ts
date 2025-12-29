import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

const PhoneRecipientSchema = z.string().min(6);

export const BroadcastTextSchema = z
  .object({
    sessionId: z.string().min(1),
    recipients: z.array(PhoneRecipientSchema).min(1).optional(),
    contactIds: z.array(z.string().min(1)).optional(),
    useAllContacts: z.boolean().optional().default(false),
    text: z.string().min(1),
    delayMs: z.number().int().min(0).default(1000),
    jitterMs: z.number().int().min(0).default(500),
    checkNumber: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    const manualCount = val.recipients?.length ?? 0;
    const contactCount = val.contactIds?.length ?? 0;
    if (manualCount === 0 && contactCount === 0 && !val.useAllContacts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide manual recipients, select contact IDs, or set useAllContacts',
        path: ['recipients'],
      });
    }
  });

export class BroadcastTextDto extends createZodDto(BroadcastTextSchema) {}

export const BroadcastImageSchema = z
  .object({
    sessionId: z.string().min(1),
    recipients: z.array(PhoneRecipientSchema).min(1).optional(),
    contactIds: z.array(z.string().min(1)).optional(),
    useAllContacts: z.boolean().optional().default(false),
    caption: z.string().min(1).optional(),
    imageUrl: z.string().url(),
    delayMs: z.number().int().min(0).default(1000),
    jitterMs: z.number().int().min(0).default(500),
    checkNumber: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    const manualCount = val.recipients?.length ?? 0;
    const contactCount = val.contactIds?.length ?? 0;
    if (!val.imageUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ImageUrl required for now',
        path: ['imageUrl'],
      });
    }
    if (manualCount === 0 && contactCount === 0 && !val.useAllContacts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide manual recipients, select contact IDs, or set useAllContacts',
        path: ['recipients'],
      });
    }
  });

export class BroadcastImageDto extends createZodDto(BroadcastImageSchema) {}
