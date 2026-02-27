import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiResponseService } from './ai-response.service';
import { agent } from 'supertest';
import { AiProvider } from './providers/ai-provider.interface';
import { AiKnowledgeService } from './ai-knowledge.service';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiResponseService: AiResponseService,
    @Inject('AI_PROVIDER')
    private readonly aiProvider: AiProvider,
    private readonly aiKnowledgeService: AiKnowledgeService,
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
      where: { sessionId },
    });

    if (!agent || !agent.isEnabled) return null;
    if (agent.mode === 'HUMAN') return null;

    // Detect Intent
    const intentRaw = await this.aiProvider.generateReply({
      systemPrompt: `
Classify the user's intent into ONE of these categories:
- GREETING
- PRODUCT_QUESTION
- PRICE_QUESTION
- SMALL_TALK
- OTHER

Respond with only the category name.
`,
      userMessage: message,
      temperature: 0,
      maxTokens: 10,
      model: agent.model,
    });

    const intent = (intentRaw ?? 'OTHER').trim().toUpperCase();
    console.log('Detected intent:', intent);

    // Load Conversation Memory
    const memories = await this.prisma.aiConversationMemory.findMany({
      where: { agentId: agent.id, jid },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    const historyText = memories
      .reverse()
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const languageInstruction =
      agent.language === 'en'
        ? 'Respond in English.'
        : 'Respond in Indonesian.';

    let reply = '';

    //  GREETING
    if (intent === 'GREETING') {
      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
You are a friendly and professional sales assistant.
${languageInstruction}
Greet warmly and offer help.

Conversation history:
${historyText}
`,
          userMessage: message,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          model: agent.model,
        })) ??
        agent.fallbackReply ??
        'Maaf, saya belum bisa menjawab saat ini silkaan hubungi admin.';

      await this.saveMemory(agent.id, jid, message, reply);
      return reply;
    }

    // PRODUCT / PRICE → Use RAG
    if (intent === 'PRODUCT_QUESTION' || intent === 'PRICE_QUESTION') {
      const queryEmbedding = await this.aiProvider.generateEmbedding(message);

      const matches = await this.aiKnowledgeService.searchSimilarChunks(
        agent.id,
        queryEmbedding,
        5,
      );

      console.log('RAG matches:', matches.length);

      const context = matches.map((m) => m.content).join('\n\n');

      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
You are a professional sales assistant.
${languageInstruction}

Use the knowledge below to answer.
Be friendly and persuasive.
Offer next step (survey, booking, etc).

Conversation history:
${historyText}

Knowledge:
${context}
`,
          userMessage: message,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          model: agent.model,
        })) ??
        agent.fallbackReply ??
        'Maaf, saya belum bisa menjawab saat ini.';

      await this.saveMemory(agent.id, jid, message, reply);
      return reply;
    }

    // SMALL TALK
    reply =
      (await this.aiProvider.generateReply({
        systemPrompt: `
You are a conversational sales assistant.
${languageInstruction}

Be natural, helpful, and engaging.

Conversation history:
${historyText}
`,
        userMessage: message,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        model: agent.model,
      })) ??
      agent.fallbackReply ??
      'Maaf, saya belum bisa menjawab saat ini.';

    await this.saveMemory(agent.id, jid, message, reply);
    return reply;
  }

  async uploadKnowledge(
    agentId: string,
    fileName: string,
    fileUrl: string,
    status: 'PROCESSING' | 'READY' | 'FAILED',
  ) {
    const agent = await this.prisma.aiAgent.findUnique({
      where: {
        id: agentId,
      },
    });

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    const fileRecord = await this.prisma.aiKnowledgeFile.create({
      data: {
        agentId,
        fileName,
        fileUrl,
        status,
      },
    });

    return fileRecord;
  }

  async searchSimilarChunks(
    agentId: string,
    queryEmbedding: number[],
    limit = 5,
  ) {
    const embeddings = await this.prisma.aiEmbedding.findMany({
      where: { agentId },
    });

    const scored = embeddings.map((item) => ({
      content: item.content,
      score: this.cosineSimilarity(queryEmbedding, item.embedding as any),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (normA * normB);
  }

  private async saveMemory(
    agentId: string,
    jid: string,
    userMessage: string,
    assistantReply: string,
  ) {
    await this.prisma.aiConversationMemory.createMany({
      data: [
        {
          agentId,
          jid,
          role: 'user',
          content: userMessage,
        },
        {
          agentId,
          jid,
          role: 'assistant',
          content: assistantReply,
        },
      ],
    });
  }
}
