import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiResponseService } from './ai-response.service';
import { AiProvider } from './providers/ai-provider.interface';
import { AiKnowledgeService } from './ai-knowledge.service';
import { KnowledgeFileType } from '@prisma/client';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiResponseService: AiResponseService,
    @Inject('AI_PROVIDER')
    private readonly aiProvider: AiProvider,
    private readonly aiKnowledgeService: AiKnowledgeService,
  ) { }

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

    // ─── Detect Intent ───────────────────────────────────────────────────────
    const intentRaw = await this.aiProvider.generateReply({
      systemPrompt: `
You are an intent classifier for a business chatbot.
Classify the user's message into EXACTLY ONE of these categories:

- GREETING          → The user is greeting (hi, hello, halo, etc.)
- PRODUCT_QUESTION  → Asking about products, services, or the company
- PRICE_QUESTION    → Asking about prices, costs, packages, or payment
- FAQ_QUESTION      → Asking about policies, process, how-to, or general questions
- SMALL_TALK        → Casual conversation not about the business
- OUT_OF_CONTEXT    → Completely off-topic (politics, celebrities, general world knowledge, etc.)

Respond with ONLY the category name, nothing else.
`,
      userMessage: message,
      temperature: 0,
      maxTokens: 10,
      model: agent.model,
    });

    const intent = (intentRaw ?? 'OTHER').trim().toUpperCase();
    console.log('Detected intent:', intent);

    // ─── Out-of-Context: return fallback immediately, no LLM call ────────────
    if (intent === 'OUT_OF_CONTEXT') {
      const fallback =
        agent.fallbackReply ??
        'Maaf, saya hanya bisa menjawab pertanyaan seputar bisnis kami. Silakan hubungi admin untuk informasi lainnya.';
      await this.saveMemory(agent.id, jid, message, fallback);
      return fallback;
    }

    // ─── Load Conversation Memory ─────────────────────────────────────────────
    const memories = await this.prisma.aiConversationMemory.findMany({
      where: { agentId: agent.id, jid },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    const historyText = memories
      .reverse()
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const persona =
      agent.systemPrompt?.trim() ||
      'You are a friendly and professional business assistant.';

    const languageInstruction =
      agent.language === 'en'
        ? 'Respond in English.'
        : 'Respond in Indonesian.';

    let reply = '';

    // ─── GREETING ─────────────────────────────────────────────────────────────
    if (intent === 'GREETING') {
      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
${persona}
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
        'Halo! Ada yang bisa saya bantu?';

      await this.saveMemory(agent.id, jid, message, reply);
      return reply;
    }

    // ─── PRODUCT_QUESTION → RAG: Company Profile + Pricelist ─────────────────
    if (intent === 'PRODUCT_QUESTION') {
      const queryEmbedding = await this.aiProvider.generateEmbedding(message);
      const matches = await this.aiKnowledgeService.searchSimilarChunks(
        agent.id,
        queryEmbedding,
        5,
        [KnowledgeFileType.COMPANY_PROFILE, KnowledgeFileType.PRICELIST],
      );

      console.log('RAG matches (product):', matches.length);
      const context = matches.map((m) => m.content).join('\n\n');

      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
${persona}
${languageInstruction}

Use the company knowledge below to answer questions about our products and services.
Be friendly and persuasive. Offer a next step (survey, booking, consultation, etc.).

Conversation history:
${historyText}

Company Knowledge:
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

    // ─── PRICE_QUESTION → RAG: Pricelist ─────────────────────────────────────
    if (intent === 'PRICE_QUESTION') {
      const queryEmbedding = await this.aiProvider.generateEmbedding(message);
      const matches = await this.aiKnowledgeService.searchSimilarChunks(
        agent.id,
        queryEmbedding,
        5,
        [KnowledgeFileType.PRICELIST],
      );

      console.log('RAG matches (price):', matches.length);
      const context = matches.map((m) => m.content).join('\n\n');

      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
${persona}
${languageInstruction}

Use the price list below to answer pricing questions accurately.
Be transparent about prices and offer to help them choose the right package.

Conversation history:
${historyText}

Price List:
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

    // ─── FAQ_QUESTION → RAG: FAQ ──────────────────────────────────────────────
    if (intent === 'FAQ_QUESTION') {
      const queryEmbedding = await this.aiProvider.generateEmbedding(message);
      const matches = await this.aiKnowledgeService.searchSimilarChunks(
        agent.id,
        queryEmbedding,
        5,
        [KnowledgeFileType.FAQ],
      );

      console.log('RAG matches (faq):', matches.length);
      const context = matches.map((m) => m.content).join('\n\n');

      reply =
        (await this.aiProvider.generateReply({
          systemPrompt: `
${persona}
${languageInstruction}

Use the FAQ knowledge below to answer the question clearly and completely.
If the answer is not covered in the FAQ, politely say so and suggest contacting admin.

Conversation history:
${historyText}

FAQ Knowledge:
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

    // ─── SMALL_TALK (fallback for anything else) ──────────────────────────────
    reply =
      (await this.aiProvider.generateReply({
        systemPrompt: `
${persona}
${languageInstruction}

Be natural, helpful, and engaging. Gently steer the conversation back to our products or services when appropriate.

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
    fileType: KnowledgeFileType = KnowledgeFileType.FAQ,
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
        fileType,
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
