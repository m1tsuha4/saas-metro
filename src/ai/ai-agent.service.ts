import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AiAgentService {
  constructor(private readonly prisma: PrismaService) {}

  async createAgent(sessionId: string, ownerId: string, name: string, isEnabled: boolean) {
    const agent = await this.prisma.aiAgent.create({
      data: {
        sessionId,
        ownerId,
        name,
        isEnabled,
        mode: 'BOT',
        temperature: 0.7,
        maxTokens: 100,
        systemPrompt: null,
        fallbackReply: null,
      },
    });

    return agent;
  }

  async switchMode(id: string, mode: 'BOT' | 'HUMAN') {
    const agent = await this.prisma.aiAgent.update({
      where: { id },
      data: { mode },
    });

    return agent;
  }
}
