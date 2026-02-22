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
      where: {
        sessionId,
      },
    });

    if (!agent || !agent.isEnabled) return null;

    if (agent.mode === 'HUMAN') return null;

    const queryEmbedding = await this.aiProvider.generateEmbedding(message);

    const matches = await this.aiKnowledgeService.searchSimilarChunks(
      agent.id,
      queryEmbedding,
      5,
    );

    const context = matches.map((match) => match.content).join('\n\n');
    console.log('RAG matches:', matches.length);

    const finalPrompt = `
      ${agent.systemPrompt || 'You are a helpful assistant.'}

      Answer ONLY using the knowledge below.
      If the answer is not in the knowledge, say you don't know.

      Knowledge:
      ${context}

      User Question:
      ${message}
    `;
    return this.aiProvider.generateReply({
      systemPrompt: finalPrompt,
      userMessage: message,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      model: agent.model,
    });
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
}
