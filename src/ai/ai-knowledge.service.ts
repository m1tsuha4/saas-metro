import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiProvider } from './providers/ai-provider.interface';
import { Inject } from '@nestjs/common';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

@Injectable()
export class AiKnowledgeService {
  constructor(
    private prisma: PrismaService,
    @Inject('AI_PROVIDER')
    private aiProvider: AiProvider,
  ) {}

  async processPdfBuffer(agentId: string, fileId: string, buffer: Buffer) {
    try {
      // Extract text
      const text = await this.extractTextFromPdf(buffer);

      const chunks = this.chunkText(text);

      //  Generate embeddings
      for (const chunk of chunks) {
        const embedding = await (this.aiProvider as any).generateEmbedding(
          chunk,
        );

        await this.prisma.aiEmbedding.create({
          data: {
            agentId,
            content: chunk,
            embedding,
          },
        });
      }

      // Mark file READY
      await this.prisma.aiKnowledgeFile.update({
        where: { id: fileId },
        data: { status: 'READY' },
      });
    } catch (error) {
      await this.prisma.aiKnowledgeFile.update({
        where: { id: fileId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  async updateFileUrl(id: string, url: string) {
    await this.prisma.aiKnowledgeFile.update({
      where: { id },
      data: { fileUrl: url },
    });
  }

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const uint8Array = new Uint8Array(buffer);

    const loadingTask = (pdfjsLib as any).getDocument({
      data: uint8Array,
    });
    const pdf = await loadingTask.promise;

    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      const pageText = content.items.map((item: any) => item.str).join(' ');

      fullText += pageText + '\n';
    }

    return fullText;
  }

  private chunkText(text: string, size = 800): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks;
  }
}
