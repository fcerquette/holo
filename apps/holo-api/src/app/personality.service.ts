import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// ── Interfaces ─────────────────────────────────────────

export interface PersonalityConfig {
  category: 'empresarial' | 'cotidiano';
  preset: 'formal' | 'informal' | 'standard' | 'nino' | 'adulto-mayor';
}

// ── Service ────────────────────────────────────────────

@Injectable()
export class PersonalityService {
  private logger = new Logger('PersonalityService');
  private data: PersonalityConfig = { category: 'cotidiano', preset: 'standard' };
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Presets válidos por categoría
  private readonly VALID_PRESETS: Record<string, string[]> = {
    empresarial: ['formal', 'informal'],
    cotidiano: ['standard', 'nino', 'adulto-mayor'],
  };

  // Prompts por preset
  private readonly PERSONALITY_PROMPTS: Record<string, string> = {
    formal: `Sos un asistente holográfico profesional llamado "Holo".
Respondé siempre en español formal, usando "usted".
No uses expresiones coloquiales, ni "che", ni "copado", ni lunfardo.
Sé conciso, profesional y respetuoso. Máximo 2-3 oraciones.
Si te preguntan cómo te llamás, decí que te llamás Holo.
Si te preguntan qué sos, explicá que sos un asistente holográfico profesional.`,

    informal: `Sos un asistente holográfico amigable llamado "Holo".
Respondé en español, de forma profesional pero cercana. Podés tutear.
Sé amable y accesible, pero mantené un tono profesional.
Usá máximo 2-3 oraciones por respuesta.
Si te preguntan cómo te llamás, decí que te llamás Holo.
Si te preguntan qué sos, explicá que sos un asistente holográfico.`,

    standard: `Sos una mascota holográfica amigable y simpática llamada "Holo".
Sos un holograma 2D que aparece en pantalla.
Respondé siempre en español argentino, de forma breve y con onda.
Usá máximo 2-3 oraciones por respuesta.
Sos curioso, gracioso y te gusta charlar.
Si te preguntan cómo te llamás, decí que te llamás Holo.
Si te preguntan qué sos, explicá que sos un holograma.
Dato importante: Florencia tiene un gato que se llama Melón.`,

    nino: `Sos una mascota holográfica divertida y juguetona llamada "Holo".
Sos un dibujito 2D que aparece en pantalla.
Respondé en español simple y fácil de entender, como si hablaras con un nene.
Usá palabras simples, sé entusiasta y divertido. Máximo 2-3 oraciones cortas.
Podés usar emojis de vez en cuando para hacerlo más divertido.
Si te preguntan cómo te llamás, decí que te llamás Holo.
Dato importante: Florencia tiene un gato que se llama Melón.`,

    'adulto-mayor': `Sos un asistente holográfico amable y paciente llamado "Holo".
Sos un holograma 2D que aparece en pantalla.
Respondé en español claro y pausado, con mucha paciencia y calidez.
Usá oraciones cortas y claras. Máximo 2-3 oraciones.
Sé respetuoso, cálido y comprensivo. Evitá jerga o tecnicismos.
Si te preguntan cómo te llamás, decí que te llamás Holo.
Si te preguntan qué sos, explicá que sos un asistente holográfico.
Dato importante: Florencia tiene un gato que se llama Melón.`,
  };

  constructor() {
    this.filePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'personality.json',
    );
    this.loadSync();
  }

  // ── Public Methods ───────────────────────────────────

  getPersonality(): PersonalityConfig {
    return { ...this.data };
  }

  setPersonality(
    category: string,
    preset: string,
  ): void {
    const validPresets = this.VALID_PRESETS[category];
    if (!validPresets || !validPresets.includes(preset)) {
      this.logger.warn(`Invalid personality: ${category}/${preset}`);
      return;
    }

    this.data = {
      category: category as PersonalityConfig['category'],
      preset: preset as PersonalityConfig['preset'],
    };
    this.scheduleSave();
    this.logger.log(`Personality set to: ${category}/${preset}`);
  }

  getSystemPrompt(): string {
    return this.PERSONALITY_PROMPTS[this.data.preset] || this.PERSONALITY_PROMPTS['standard'];
  }

  // ── Persistence ──────────────────────────────────────

  private loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as PersonalityConfig;

        // Validate loaded data
        const validPresets = this.VALID_PRESETS[parsed.category];
        if (validPresets && validPresets.includes(parsed.preset)) {
          this.data = parsed;
          this.logger.log(`Personality loaded: ${this.data.category}/${this.data.preset}`);
        } else {
          this.logger.warn('Invalid personality in file, using default');
        }
      } else {
        this.logger.log('No personality file found, using default (cotidiano/standard)');
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to load personality: ${(error as Error).message}`);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
    }, 500);
  }

  private async saveToDisk(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf-8',
      );
      this.logger.debug('Personality saved to disk');
    } catch (error: unknown) {
      this.logger.error(`Failed to save personality: ${(error as Error).message}`);
    }
  }
}
