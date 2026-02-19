import { Injectable } from '@nestjs/common';
import { AiProvider } from './ai-provider.interface';

@Injectable()
export class MockAiProvider implements AiProvider {
  async generateReply(params: {
    systemPrompt?: string | null;
    userMessage: string;
  }): Promise<string> {
    return `[MOCK AI]\nYou said: "${params.userMessage}"`;
  }
}
