import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAgentService } from './ai-agent.service';
import { ApiBody } from '@nestjs/swagger';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiAgentService: AiAgentService,
  ) {}

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { example: 'cmlha0mid0000mezwjmb13x6j' },
        ownerId: { example: 'cmlha0mid0000mezwjmb13x6j' },
        name: { example: 'mitsuha' },
      },
    },
  })
  @Post()
  async createAgent(
    @Body('sessionId') sessionId: string,
    @Body('ownerId') ownerId: string,
    @Body('name') name: string,
  ) {
    return this.aiAgentService.createAgent(sessionId, ownerId, name);
  }

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { example: 'cmlha0mid0000mezwjmb13x6j' },
        mode: { example: 'HUMAN' },
      },
    },
  })
  @Patch(':id/mode')
  async switchMode(
    @Param('id') id: string,
    @Body('mode') mode: 'BOT' | 'HUMAN',
  ) {
    return this.aiAgentService.switchMode(id, mode);
  }
}
