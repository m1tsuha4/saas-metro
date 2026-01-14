import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

export const UserQuerySchema = z.object({
    page: z.coerce.number().min(1).optional().default(1),
    limit: z.coerce.number().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    role: z.enum(['USER', 'ADMIN']).optional(),
});

export class UserQueryDto extends createZodDto(UserQuerySchema) { }
