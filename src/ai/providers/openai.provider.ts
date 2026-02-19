import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AiProvider } from './ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }

  async generateReply(params: {
    systemPrompt?: string | null;
    userMessage: string;
    temperature: number;
    maxTokens: number;
    model: string;
  }): Promise<string | null> {
    const completion = await this.openai.chat.completions.create({
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      messages: [
        {
          role: 'system',
          content:
            params.systemPrompt || 'You are a helpful WhatsApp assistant.',
        },
        {
          role: 'user',
          content: params.userMessage,
        },
      ],
    });

    return completion.choices[0]?.message?.content ?? null;
  }
}
