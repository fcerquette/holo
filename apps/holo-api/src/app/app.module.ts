import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HoloGateway } from './holo.gateway';
import { LlmService } from './llm.service';
import { ConversationStore } from './conversation-store.service';
import { RagService } from './rag.service';
import { SqlService } from './sql.service';
import { MemoryRagService } from './memory-rag.service';
import { PersonalityService } from './personality.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    HoloGateway,
    LlmService,
    ConversationStore,
    RagService,
    SqlService,
    MemoryRagService,
    PersonalityService,
  ],
})
export class AppModule {}
