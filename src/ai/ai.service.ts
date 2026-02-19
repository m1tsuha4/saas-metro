import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiResponseService } from './ai-response.service';
import { agent } from 'supertest';
import { AiProvider } from './providers/ai-provider.interface';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiResponseService: AiResponseService,
    @Inject('AI_PROVIDER')
    private readonly aiProvider: AiProvider,
  ) {}

  async handleIncomingMessage(params: {
    sessionId: string;
    jid: string;
    message: string;
    fromMe: boolean;
    isGroup: boolean;
  }) {
    const { sessionId, jid, message, fromMe, isGroup } = params;

    if (fromMe || isGroup) return null;

    const agent = await this.prisma.aiAgent.findUnique({
      where: {
        sessionId,
      },
    });

    if (!agent || !agent.isEnabled) return null;

    if (agent.mode === 'HUMAN') return null;

    return this.aiProvider.generateReply({
      systemPrompt: agent.systemPrompt,
      userMessage: message,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      model: agent.model,
    });
  }
}
