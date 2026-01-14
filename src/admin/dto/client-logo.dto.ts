import { createZodDto } from '@anatine/zod-nestjs';
import { z } from 'zod';

export const CreateClientLogoSchema = z.object({
    imageUrl: z.string().url(),
});

export class CreateClientLogoDto extends createZodDto(CreateClientLogoSchema) { }

export const UpdateClientLogoSchema = z.object({
    imageUrl: z.string().url().optional(),
});

export class UpdateClientLogoDto extends createZodDto(UpdateClientLogoSchema) { }
