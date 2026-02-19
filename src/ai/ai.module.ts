import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiResponseService } from './ai-response.service';
import { AiAgentService } from './ai-agent.service';
import { OpenAiProvider } from './providers/openai.provider';
import { MockAiProvider } from './providers/mock-ai.provider';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiResponseService,
    AiAgentService,
    {
      provide: 'AI_PROVIDER',
      useFactory: () => {
        if (process.env.AI_PROVIDER === 'openai') {
          return new OpenAiProvider();
        } else if (process.env.AI_PROVIDER === 'gemini') {
          return new GeminiProvider();
        } else {
          return new MockAiProvider();
        }
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
