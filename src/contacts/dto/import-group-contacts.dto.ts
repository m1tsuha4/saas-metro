import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

export const ImportGroupContactsSchema = z.object({
    sessionId: z.string().trim().min(1),
    groupJid: z.string().trim().min(1),
});

export class ImportGroupContactsDto extends createZodDto(
    ImportGroupContactsSchema,
) { }
