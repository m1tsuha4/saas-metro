import { createZodDto } from "@anatine/zod-nestjs";
import { z } from "zod";

export const SendSchema = z.object({
    sessionId: z.string().min(1),
    to: z.string().min(6),
    text: z.string().min(1),
});

export class SendDto extends createZodDto(SendSchema) {}