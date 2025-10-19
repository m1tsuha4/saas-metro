import { createZodDto } from "@anatine/zod-nestjs";
import { z } from "zod";

export const BroadcastTextSchema = z.object({
    sessionId: z.string().min(1),
    recipients: z.array(z.string().min(6)).min(1),
    text: z.string().min(1),
    delayMs: z.number().int().min(0).default(1000),
    jitterMs: z.number().int().min(0).default(500),
    checkNumber: z.boolean().default(true),
});

export class BroadcastTextDto extends createZodDto(BroadcastTextSchema) {}

export const BroadcastImageSchema = z.object({
    sessionId: z.string().min(1),
    recipients: z.array(z.string().min(6)).min(1),
    caption: z.string().min(1).optional(),
    imageUrl: z.string().url(),
    delayMs: z.number().int().min(0).default(1000),
    jitterMs: z.number().int().min(0).default(500),
    checkNumber: z.boolean().default(true),
}).refine(d => !!d.imageUrl, { message: "ImageUrl required for now"});

export class BroadcastImageDto extends createZodDto(BroadcastImageSchema) {}