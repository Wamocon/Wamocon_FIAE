/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  detectMemoryCandidates,
  dimensionOf,
} from '@/lib/hai/memory/memoryDetect';

// An EXPLICIT statement about a preference is recognised by pattern matching,
// an uncertain case produces nothing. The text of the entry is a fixed template,
// never a part of the message.

const keysOf = (message: string) =>
  detectMemoryCandidates(message).map(c => c.key);

describe('detectMemoryCandidates: hits', () => {
  it.each([
    ['antworte kürzer', 'pref.length.short'],
    ['Antworte bitte etwas kürzer', 'pref.length.short'],
    ['Halt dich bitte kurz', 'pref.length.short'],
    ['Bitte immer kurze Antworten', 'pref.length.short'],
    ['Ich möchte kurze Antworten', 'pref.length.short'],
    ['Erkläre immer kurz', 'pref.length.short'],
    ['Antworte bitte ausführlicher', 'pref.length.long'],
    ['Ich möchte detaillierte Antworten', 'pref.length.long'],
    ['Bitte duzen', 'pref.address.du'],
    ['Du kannst mich duzen', 'pref.address.du'],
    ['Duze mich bitte', 'pref.address.du'],
    ['Sprich mich bitte mit Du an', 'pref.address.du'],
    ['Bitte siezen', 'pref.address.sie'],
    ['Sprich mich bitte mit Sie an', 'pref.address.sie'],
    ['Erklär mir das mit Beispielen', 'pref.explain.examples'],
    ['Erkläre das bitte immer mit einem Beispiel', 'pref.explain.examples'],
    ['Gib mir mehr Beispiele', 'pref.explain.examples'],
    ['Erkläre mir das Schritt für Schritt', 'pref.explain.steps'],
    ['Erkläre es in einfachen Worten', 'pref.explain.simple'],
    ['Erkläre mir das einfacher', 'pref.explain.simple'],
    ['Ich lerne besser mit Karten', 'style.form.cards'],
    ['Ich lerne am besten mit Karteikarten', 'style.form.cards'],
    ['Ich lerne besser durch Quizfragen', 'style.form.quiz'],
    ['Ich lerne am besten durch Ausprobieren', 'style.form.practice'],
    ['Ich lerne besser mit Skizzen', 'style.form.visual'],
    ['Ich spreche lieber, als zu tippen', 'style.input.voice'],
    ['Ich tippe lieber', 'style.input.text'],
  ])('%p gives %p', (message, key) => {
    expect(keysOf(message)).toContain(key);
  });

  it('gives the fixed template, never words of the message', () => {
    const [candidate] = detectMemoryCandidates(
      'Antworte kürzer, Klaus Müller wohnt in Berlin'
    );
    expect(candidate).toEqual({
      kind: 'preference',
      key: 'pref.length.short',
      content: 'Bevorzugt kurze, knappe Antworten.',
    });
    expect(candidate.content).not.toMatch(/Klaus|Berlin/);
  });

  it('marks the learning style entries as such', () => {
    const [candidate] = detectMemoryCandidates('Ich lerne besser mit Karten');
    expect(candidate.kind).toBe('learning_style');
  });

  it('offers several different statements in one message, one per dimension', () => {
    expect(keysOf('Antworte kürzer und bitte duzen')).toEqual([
      'pref.length.short',
      'pref.address.du',
    ]);
  });

  it('reads spoken umlauts the same way (ue instead of ü)', () => {
    expect(keysOf('antworte bitte kuerzer')).toContain('pref.length.short');
    expect(keysOf('erklaer mir das mit Beispielen')).toContain(
      'pref.explain.examples'
    );
  });
});

describe('detectMemoryCandidates: no hit, no proposal', () => {
  it.each([
    'Wie antworte ich kürzer?',
    'Was bedeutet duzen?',
    'Kannst du mir erklären, was ein Join ist?',
    'Warum antwortest du so ausführlich?',
    'Erkläre mir kurz, was ein Join ist',
    'Erkläre mir den Join mit Beispielen',
    'Was ist ein Beispiel für eine Schleife',
    'Hallo, wie geht es dir',
    'Antworte nicht kürzer',
    'Bitte nicht duzen',
    'Ich möchte keine kurzen Antworten',
    'Wenn du magst, antworte kürzer',
    'Vielleicht antworte ich kürzer',
    'Falls es geht, bitte duzen',
    'Der Trainer sagt, antworte kürzer',
    'Er sagte „antworte kürzer“',
    "Schreib 'antworte kürzer' in die Datei",
    'Ich finde duzen komisch',
    'Ich lerne manchmal besser mit Karten',
    '',
    '   ',
  ])('%p gives nothing', message => {
    expect(detectMemoryCandidates(message)).toEqual([]);
  });

  it('gives nothing for a long text (a pasted text is no statement)', () => {
    const long = `antworte kürzer ${'x '.repeat(200)}`;
    expect(detectMemoryCandidates(long)).toEqual([]);
  });

  it('gives nothing for two statements that contradict each other', () => {
    expect(
      detectMemoryCandidates('Antworte kürzer, nein antworte ausführlicher')
    ).toEqual([]);
    expect(detectMemoryCandidates('bitte duzen und bitte siezen')).toEqual([]);
  });

  it('survives a value that is no text', () => {
    expect(detectMemoryCandidates(undefined as unknown as string)).toEqual([]);
    expect(detectMemoryCandidates(5 as unknown as string)).toEqual([]);
  });
});

describe('dimensionOf', () => {
  it('cuts the value of a key', () => {
    expect(dimensionOf('pref.length.short')).toBe('pref.length');
    expect(dimensionOf('style.input.voice')).toBe('style.input');
    expect(dimensionOf('state')).toBe('state');
  });
});
