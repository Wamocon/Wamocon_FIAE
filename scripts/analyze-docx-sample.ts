/**
 * Analyze DOCX Sample - Reads a sample scenario file to understand structure
 */

import * as path from 'path';
import * as fs from 'fs';
import mammoth from 'mammoth';

const SAMPLE_FILES = [
  'D:/FIAE UI/Wamocon_FIAE/Szenarien/K01_ Planen, Vorbereiten und Durchführen von Arbeitsaufgaben (§4 Absatz 2 Nr 1)/01_01_Merkmale und Methoden des Projektmanagements/Szenario parts/Part1_Grundlagen_und_Projektinitialisierung.docx',
  'D:/FIAE UI/Wamocon_FIAE/Szenarien/K04_Entwickeln, Erstellen und Betreuen (§4 Absatz 2 Nr 4)/04_01_IT-Systeme unter Berücksichtigung des IT- Umfeldes konzeptionieren, konfigurieren, testen und dokumentieren können/Szenario parts/Part1_Anforderungsmanagement_KORR.docx',
  'D:/FIAE UI/Wamocon_FIAE/Szenarien/K10_Konzipieren und Umsetzen von Softwareanwendungen (§4 Absatz 3 Nr 1)/04_01_Lasten-Pflichtenheft erstellen können/Szenario parts/Part1_Detaillierung_und_Qualitaetsanforderungen.docx',
];

async function analyzeDOCX(filePath: string): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`FILE: ${path.basename(filePath)}`);
  console.log('='.repeat(80));
  
  if (!fs.existsSync(filePath)) {
    console.log('  FILE NOT FOUND');
    return;
  }
  
  try {
    // Extract raw text
    const textResult = await mammoth.extractRawText({ path: filePath });
    console.log('\n--- RAW TEXT (first 3000 chars) ---');
    console.log(textResult.value.substring(0, 3000));
    
    // Extract HTML to see tables
    const htmlResult = await mammoth.convertToHtml({ path: filePath });
    const hasTable = htmlResult.value.includes('<table');
    console.log('\n--- CONTAINS TABLE: ' + hasTable + ' ---');
    
    if (hasTable) {
      // Extract table content
      const tableMatch = htmlResult.value.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
      if (tableMatch) {
        console.log(`Found ${tableMatch.length} tables`);
        console.log('\n--- TABLE HTML (first table) ---');
        console.log(tableMatch[0].substring(0, 1500));
      }
    }
    
    // Look for section headers
    const text = textResult.value;
    console.log('\n--- SECTION HEADERS FOUND ---');
    const headerPatterns = [
      /Behandelte Themen/gi,
      /Lernziele?/gi,
      /Theoretische Grundlagen/gi,
      /Ausgangslage/gi,
      /Problem[-\s]*[Ll][öo]sung/gi,
      /PROBLEM\s*\d+/gi,
      /Aufgabe/gi,
      /L[öo]sung/gi,
      /LOESUNG/gi,
      /Checkliste/gi,
      /Szenario/gi,
    ];
    
    for (const pattern of headerPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        console.log(`  ${pattern.source}: ${matches.length} occurrences -> ${matches.slice(0, 3).join(', ')}`);
      }
    }
    
    // Check for numbered problems
    const numberedProblems = text.match(/^\d+\.\s+[A-Z][^\n]+/gm);
    if (numberedProblems) {
      console.log('\n--- NUMBERED SECTIONS ---');
      numberedProblems.slice(0, 5).forEach(p => console.log(`  ${p.substring(0, 80)}`));
    }
    
  } catch (err) {
    console.log('  ERROR: ', err);
  }
}

async function main() {
  console.log('Analyzing sample DOCX files...\n');
  
  for (const file of SAMPLE_FILES) {
    await analyzeDOCX(file);
  }
}

main().catch(console.error);
