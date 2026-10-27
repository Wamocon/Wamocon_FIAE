// Invented inputs for the tests of the transfer (package U7): files of a run with
// their decisions. Word files are built from the blocks of uploadFixtures, so the
// parsers read exactly what a real docx would give them. Nothing comes from an
// original file.
import { createHash } from 'node:crypto';

import type { TransferFile } from '@/lib/content-upload/transfer/types';

import {
  docxFromBlocks,
  enablerBlocks,
  quizBlocks,
  scenarioBlocks,
  useCaseBlocks,
  type Block,
} from './uploadFixtures';

export const T1 = 'Komponente Teil 1 (1-15 Monate)';
export const K1_DIR = `${T1}/01 - Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)`;
export const K4_DIR = `${T1}/04 - Erfundenes Thema Vier (§ 4 Abs. 2 Nr. 4)`;

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

let counter = 0;
const uuid = () => {
  counter += 1;
  const tail = String(counter).padStart(12, '0');
  return `aaaaaaaa-0000-4000-8000-${tail}`;
};

export interface FixtureFile {
  file: TransferFile;
  bytes: Uint8Array;
}

export interface FixtureOptions {
  /** Path as the browser reported it. Without a tree: only the file name. */
  rel?: string;
  name?: string;
  ext?: 'docx' | 'pdf' | 'json' | 'xlsx';
  action?: 'accept' | 'reject' | 'defer';
  docType: string | null;
  componentCode?: string | null;
  enablerCode?: string | null;
  quizLevel?: 'low' | 'medium' | 'high' | null;
  dupChoice?: 'keep' | 'skip' | null;
  dupKey?: string | null;
  mtimeMs?: number;
  objectDeleted?: boolean;
  status?: string;
}

export function fixtureFile(
  bytes: Uint8Array,
  options: FixtureOptions
): FixtureFile {
  const id = uuid();
  const ext = options.ext ?? 'docx';
  const name = options.name ?? `datei-${id.slice(-4)}.${ext}`;
  return {
    bytes,
    file: {
      id,
      relPath: options.rel ?? name,
      fileName: name,
      ext,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      mtimeMs: options.mtimeMs ?? Date.UTC(2026, 9, 20, 8, 0, 0),
      storagePath: `upload/aaaaaaaa-0000-4000-8000-000000000000/${id}.${ext}`,
      status: options.status ?? 'decided',
      dupKey: options.dupKey ?? null,
      objectDeleted: options.objectDeleted === true,
      decision: {
        id: uuid(),
        action: options.action ?? 'accept',
        docType: options.docType,
        componentCode: options.componentCode ?? null,
        enablerCode: options.enablerCode ?? null,
        quizLevel: options.quizLevel ?? null,
        dupChoice: options.dupChoice ?? null,
        decisionsVersion: 1,
      },
    },
  };
}

export async function docx(blocks: Block[]): Promise<Uint8Array> {
  return new Uint8Array(await docxFromBlocks(blocks));
}

/** A quiz JSON file (schema 1.0) as an accepted file of a run. */
export function jsonQuizFile(
  content: unknown,
  options: Partial<FixtureOptions> & { kind?: 'lesson' | 'global' } = {}
): FixtureFile {
  const { kind = 'lesson', ...rest } = options;
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return fixtureFile(new TextEncoder().encode(text), {
    ext: 'json',
    docType: kind === 'lesson' ? 'quiz' : 'global_quiz',
    name: kind === 'lesson' ? 'quizze.json' : 'global.json',
    ...rest,
  });
}

/** An Excel mapping file as an accepted file of a run (docType other). */
export function xlsxMappingFile(
  bytes: Uint8Array,
  options: Partial<FixtureOptions> = {}
): FixtureFile {
  return fixtureFile(bytes, {
    ext: 'xlsx',
    docType: 'other',
    name: 'zuordnung.xlsx',
    ...options,
  });
}

/**
 * The files of one enabler of K4 (a): the text, a quiz of level low, a scenario
 * and a use case. With `tree` the paths are those of the source tree.
 */
export async function enablerFiles(
  options: { tree?: boolean; code?: string; tag?: string } = {}
): Promise<FixtureFile[]> {
  const letter = options.code ?? 'a';
  const enablerCode = `K4-${letter}`;
  const key = `4${letter}`;
  const tree = options.tree !== false;
  const path = (rest: string) => (tree ? `${K4_DIR}/${rest}` : undefined);
  return [
    fixtureFile(
      await docx(
        enablerBlocks({ code: key, title: `Netzwerkgeräte ${letter}` })
      ),
      {
        rel: path(`Enablers/${key}_Thema/${key}.docx`),
        name: `${key}.docx`,
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode,
      }
    ),
    fixtureFile(await docx(quizBlocks({ code: key, questions: 5 })), {
      rel: path(`Enablers/${key}_Thema/Quiz/${key}_Quiz_Low.docx`),
      name: `${key}_Quiz_Low.docx`,
      docType: 'quiz',
      componentCode: 'K4',
      enablerCode,
      quizLevel: 'low',
    }),
    fixtureFile(await docx(scenarioBlocks({ code: key })), {
      rel: path(`Enablers/${key}_Thema/Szenario/Szenario_${key}.docx`),
      name: `Szenario_${key}.docx`,
      docType: 'scenario',
      componentCode: 'K4',
      enablerCode,
    }),
    fixtureFile(
      await docx(
        useCaseBlocks({ code: key, title: `Rechnungen prüfen ${letter}` })
      ),
      {
        rel: path(`K4_Use-Cases/UC_${key}.docx`),
        name: `UC_${key}.docx`,
        docType: 'use_case',
        componentCode: 'K4',
        enablerCode,
      }
    ),
  ];
}
