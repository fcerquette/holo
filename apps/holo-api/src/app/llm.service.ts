import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { ConversationStore } from './conversation-store.service';
import { RagService } from './rag.service';
import { SqlService } from './sql.service';
import { MemoryRagService } from './memory-rag.service';
import { PersonalityService } from './personality.service';
import { KnowledgeService } from './knowledge.service';

export interface ChatResponse {
  text: string;
  expression: string;
}

@Injectable()
export class LlmService {
  private logger = new Logger('LlmService');
  private client: Groq;

  // Expression instruction appended to every system prompt
  private readonly expressionInstruction =
    '\n\nREGLA OBLIGATORIA: Tu último token SIEMPRE debe ser una de estas etiquetas exactas: [neutral] [feliz] [sorprendido] [triste] [enojado] [avergonzado]. ' +
    'NUNCA escribas emociones, emojis, acotaciones ni descripciones de tu estado de ánimo en el texto. ' +
    'Ejemplo correcto: "¡Qué buena onda! [feliz]". Ejemplo incorrecto: "¡Qué buena onda! *sonríe*".';

  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly ragService: RagService,
    private readonly sqlService: SqlService,
    private readonly memoryRagService: MemoryRagService,
    private readonly personalityService: PersonalityService,
    private readonly knowledgeService: KnowledgeService,
  ) {
    this.client = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
    });
  }

  /** Dynamic base system prompt from personality config */
  private get baseSystemPrompt(): string {
    return this.personalityService.getSystemPrompt();
  }

  /** Build the system prompt, including owner info if available */
  private getSystemPrompt(): string {
    const owner = this.conversationStore.getOwnerName();
    if (owner) {
      return (
        this.baseSystemPrompt +
        `\nTu dueño/a se llama "${owner}". Lo/la conocés y le tenés cariño. ` +
        `Podés mencionarlo/a por su nombre de vez en cuando.`
      );
    }
    return this.baseSystemPrompt;
  }

  /** Extract SQL code block from LLM response */
  private extractSqlQuery(text: string): string | null {
    const match = text.match(/```sql\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  }

  /** Extract expression tag from LLM response and return clean text */
  private extractExpression(text: string): { cleanText: string; expression: string } {
    // Canonical tags → frontend expression names
    const tagMap: Record<string, string> = {
      neutral: 'neutral',
      feliz: 'happy',
      sorprendido: 'surprised',
      triste: 'sad',
      enojado: 'angry',
      avergonzado: 'embarrassed',
    };

    // Fuzzy synonyms the LLM sometimes uses instead of the canonical tags
    const synonymMap: Record<string, string> = {
      // happy variants
      feliz: 'happy', contento: 'happy', contenta: 'happy', alegre: 'happy',
      sonrisa: 'happy', sonríe: 'happy', sonrie: 'happy', sonriendo: 'happy',
      'cara feliz': 'happy', risueño: 'happy', risueña: 'happy',
      happy: 'happy', smile: 'happy',
      // sad variants
      triste: 'sad', tristeza: 'sad', melancolico: 'sad', melancólico: 'sad',
      apenado: 'sad', apenada: 'sad', sad: 'sad',
      // surprised variants
      sorprendido: 'surprised', sorprendida: 'surprised', sorpresa: 'surprised',
      asombrado: 'surprised', asombrada: 'surprised', surprised: 'surprised',
      impresionado: 'surprised', impresionada: 'surprised',
      // angry variants
      enojado: 'angry', enojada: 'angry', furioso: 'angry', furiosa: 'angry',
      molesto: 'angry', molesta: 'angry', angry: 'angry', frustrado: 'angry',
      // embarrassed variants
      avergonzado: 'embarrassed', avergonzada: 'embarrassed',
      vergüenza: 'embarrassed', verguenza: 'embarrassed',
      tímido: 'embarrassed', timido: 'embarrassed', tímida: 'embarrassed', timida: 'embarrassed',
      ruborizado: 'embarrassed', ruborizada: 'embarrassed', sonrojado: 'embarrassed', sonrojada: 'embarrassed',
      embarrassed: 'embarrassed', shy: 'embarrassed',
      // neutral variants
      neutral: 'neutral', pensativo: 'neutral', pensativa: 'neutral',
      'cara pensativa': 'neutral', curioso: 'neutral', curiosa: 'neutral',
      serio: 'neutral', seria: 'neutral', tranquilo: 'neutral', tranquila: 'neutral',
    };

    let cleanText = text;
    let expression = 'neutral';

    // 1. Try exact canonical tag: [feliz], [triste], etc.
    const exactMatch = cleanText.match(/\[(neutral|feliz|sorprendido|triste|enojado|avergonzado)\]\s*$/i);
    if (exactMatch) {
      expression = tagMap[exactMatch[1].toLowerCase()] || 'neutral';
      cleanText = cleanText.replace(exactMatch[0], '').trimEnd();
      return { cleanText, expression };
    }

    // 2. Try bracket tag with synonym: [pensativo], [sonrisa], [contento], etc.
    const synonymKeys = Object.keys(synonymMap).join('|');
    const bracketSynonym = cleanText.match(new RegExp(`\\[(${synonymKeys})\\]\\s*$`, 'i'));
    if (bracketSynonym) {
      expression = synonymMap[bracketSynonym[1].toLowerCase()] || 'neutral';
      cleanText = cleanText.replace(bracketSynonym[0], '').trimEnd();
      return { cleanText, expression };
    }

    // 3. Clean up common LLM junk: *sonríe*, (cara pensativa), emoji faces, etc.
    // Asterisk actions: *sonríe*, *cara pensativa*
    cleanText = cleanText.replace(/\*[^*]{2,30}\*\s*$/g, '').trimEnd();
    // Parenthetical actions: (sonríe), (cara pensativa)
    cleanText = cleanText.replace(/\([^)]{2,30}\)\s*$/g, '').trimEnd();
    // Trailing emojis (face-related)
    cleanText = cleanText.replace(/[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}\u{1F970}-\u{1F976}\u{263A}\u{2639}]+\s*$/gu, '').trimEnd();

    // 4. Try to infer expression from what was cleaned off
    const removed = text.slice(cleanText.length).toLowerCase();
    if (removed) {
      for (const [keyword, expr] of Object.entries(synonymMap)) {
        if (removed.includes(keyword)) {
          expression = expr;
          break;
        }
      }
    }

    return { cleanText, expression };
  }

  async chat(userMessage: string): Promise<ChatResponse> {
    try {
      // Persist user message
      this.conversationStore.addUserMessage(userMessage);

      // Check if SQL is active
      const sqlEnabled = this.sqlService.isEnabled();
      const sqlActive = sqlEnabled && this.sqlService.hasActiveSchema();

      // Build LLM history with Memory RAG optimization
      const fullHistory = this.conversationStore.getLlmHistory();
      let llmHistory: typeof fullHistory;
      let memoryContext: string | null = null;

      if (sqlActive) {
        // SQL mode: minimal history (token-heavy with schema)
        llmHistory = fullHistory.slice(-4);
      } else if (!sqlEnabled && this.memoryRagService.isAvailable()) {
        // Memory RAG: only when SQL is NOT enabled (SQL has priority)
        memoryContext = await this.memoryRagService.retrieveMemories(userMessage);
        llmHistory = fullHistory.slice(-2);
        if (memoryContext) {
          this.logger.debug('Memory context injected into prompt');
        }
      } else {
        // Fallback: full history (current behavior)
        llmHistory = fullHistory;
      }

      // Build system prompt
      let systemPrompt = this.getSystemPrompt();

      // Memory RAG: inject relevant memories
      if (memoryContext) {
        systemPrompt += `\n\n${memoryContext}`;
      }

      // RAG: only inject if SQL is NOT active (avoid double context cost)
      if (!sqlActive) {
        let contextInjected = false;

        // 1. Try Ollama RAG first (embeddings-based, higher quality)
        const ragContext =
          await this.ragService.retrieveContext(userMessage);
        if (ragContext) {
          systemPrompt +=
            `\n\nInfo de tu base de conocimiento:\n${ragContext}` +
            `\nUsá esta info si es relevante.`;
          this.logger.debug('RAG context injected into prompt');
          contextInjected = true;
        }

        // 2. Fallback: keyword-based knowledge (works without Ollama)
        if (!contextInjected) {
          const knowledgeContext = this.knowledgeService.retrieveContext(userMessage);
          if (knowledgeContext) {
            systemPrompt +=
              `\n\nInfo de tu base de conocimiento:\n${knowledgeContext}` +
              `\nUsá esta info si es relevante.`;
            this.logger.debug('Knowledge context (keywords) injected into prompt');
          }
        }
      }

      // SQL: inject filtered schema
      if (sqlActive) {
        const schemaText = this.sqlService.getFilteredSchema(userMessage);
        if (schemaText) {
          const mode = this.sqlService.getMode();
          systemPrompt +=
            `\n\nDB PostgreSQL:\n${schemaText}\n` +
            `Generá SQL en bloque \`\`\`sql\`\`\`. Solo SELECT.` +
            (mode === 'query-only'
              ? ' Mostrá el query y explicá breve.'
              : ' El sistema lo ejecuta y te da resultados.');
          this.logger.debug('SQL schema injected into prompt');
        }
      }

      // Add expression instruction to system prompt
      systemPrompt += this.expressionInstruction;

      // Adjust LLM params: SQL mode uses fewer output tokens
      const maxTokens = sqlActive ? 256 : 256;
      const temperature = sqlActive ? 0.2 : 0.8;

      const response = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          ...llmHistory,
        ],
      });

      let assistantMessage = response.choices[0]?.message?.content || '';

      // SQL Execute mode: run the query and get a follow-up response
      if (sqlActive && this.sqlService.getMode() === 'execute') {
        const sqlQuery = this.extractSqlQuery(assistantMessage);
        if (sqlQuery) {
          this.logger.log(`Executing SQL: ${sqlQuery}`);
          const queryResult = await this.sqlService.executeQuery(sqlQuery);

          if (queryResult.rows && queryResult.rows.length > 0) {
            // Compact JSON (no pretty print)
            const resultsJson = JSON.stringify(queryResult.rows);

            const followUp = await this.client.chat.completions.create({
              model: 'llama-3.3-70b-versatile',
              max_tokens: 256,
              temperature: 0.5,
              messages: [
                {
                  role: 'system',
                  content:
                    'Sos Holo, asistente holográfico. Respondé en argentino, breve y copado. Explicá los datos sin JSON ni tablas. ' +
                    'NUNCA escribas emociones, emojis ni acotaciones como *sonríe* o (cara pensativa).' +
                    this.expressionInstruction,
                },
                {
                  role: 'user',
                  content: `Pregunta: "${userMessage}"\nResultados (${queryResult.rowCount} filas${queryResult.truncated ? ', max 20' : ''}):\n${resultsJson}`,
                },
              ],
            });

            assistantMessage =
              followUp.choices[0]?.message?.content || assistantMessage;
          } else if (queryResult.rows && queryResult.rows.length === 0) {
            assistantMessage =
              'Ejecuté la consulta pero no encontré resultados. Probá con otros datos. [neutral]';
          } else if (queryResult.error) {
            this.logger.error(`SQL execution error: ${queryResult.error}`);
            assistantMessage =
              'La consulta no salió bien. Probá preguntarme de otra forma. [triste]';
          }
        }
      }

      // Extract expression tag and clean the message
      const { cleanText, expression } = this.extractExpression(assistantMessage);

      // Persist clean assistant response (without expression tag)
      this.conversationStore.addAssistantMessage(cleanText);

      // Async: create memory embedding (non-blocking)
      this.memoryRagService
        .addMemory(userMessage, cleanText)
        .catch((err) => {
          this.logger.warn(`Memory embedding failed: ${err.message}`);
        });

      this.logger.log(`User: "${userMessage}" → Holo: "${cleanText}" [${expression}]`);

      return { text: cleanText, expression };
    } catch (error: unknown) {
      const errMsg = (error as Error).message || '';
      this.logger.error(`LLM Error: ${errMsg}`);

      if (
        errMsg.includes('api_key') ||
        errMsg.includes('API key') ||
        errMsg.includes('authentication')
      ) {
        return {
          text: 'Necesito que configures mi API key de Groq para poder pensar. Creá una cuenta gratis en console.groq.com y poné la key en el archivo .env del holo-api.',
          expression: 'sad',
        };
      }

      if (errMsg.includes('rate_limit') || errMsg.includes('429')) {
        const waitMatch = errMsg.match(/try again in (\d+[hm]\S*)/);
        const waitTime = waitMatch ? waitMatch[1] : 'un rato';
        return {
          text: `Me quedé sin créditos de Groq por ahora. Esperá ${waitTime} y probá de nuevo.`,
          expression: 'sad',
        };
      }

      if (errMsg.includes('reduce the length')) {
        return {
          text: 'La consulta es muy grande para procesar. Probá ser más específico.',
          expression: 'surprised',
        };
      }

      return {
        text: 'Uy, se me trabó el cerebro holográfico. Probá de nuevo en un ratito.',
        expression: 'sad',
      };
    }
  }

  clearHistory() {
    this.conversationStore.clear();
    this.memoryRagService.clear();
  }
}
