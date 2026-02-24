import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AiAgentService {
  constructor(private readonly prisma: PrismaService) {}

  async getAgent(sessionId: string) {
    const agent = await this.prisma.aiAgent.findUnique({
      where: { sessionId },
    });

    return agent;
  }

  async createAgent(
    sessionId: string,
    ownerId: string,
    name: string,
    isEnabled: boolean,
  ) {
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

  async updateAgent(
    id: string,
    data: {
      name?: string;
      isEnabled?: boolean;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string | null;
      fallbackReply?: string | null;
    },
  ) {
    const agent = await this.prisma.aiAgent.update({
      where: { id },
      data,
      include: { knowledgeFiles: true },
    });

    return agent;
  }

  async toggleEnabled(id: string) {
    const current = await this.prisma.aiAgent.findUnique({ where: { id } });
    if (!current) throw new Error('Agent not found');

    const agent = await this.prisma.aiAgent.update({
      where: { id },
      data: { isEnabled: !current.isEnabled },
    });

    return agent;
  }
}
