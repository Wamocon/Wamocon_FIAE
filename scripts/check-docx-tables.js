/**
 * Check if the source DOCX has actual tables in Lösung section
 */
const mammoth = require('mammoth');

const DOCXPath = 'D:/FIAE UI/Wamocon_FIAE/Szenarien/K04_Entwickeln, Erstellen und Betreuen (§4 Absatz 2 Nr 4)/04_08_Grundlagen von relationalen Datenbanken kennen und anwenden können/Szenario parts/Part1_Grundlagen_relationaler_Datenbanken_korrigiert.docx';

async function check() {
  const { value: html } = await mammoth.convertToHtml({ path: DOCXPath });
  const { value: text } = await mammoth.extractRawText({ path: DOCXPath });
  
  console.log('=== FULL DOCUMENT ANALYSIS ===');
  console.log('Total HTML length:', html.length);
  console.log('Has <table> tags:', html.includes('<table'));
  
  // Count tables
  const tableMatches = html.match(/<table[^>]*>/gi);
  console.log('Number of tables:', tableMatches ? tableMatches.length : 0);
  
  // Find LÖSUNG sections
  const loesungMatches = [...html.matchAll(/(LÖSUNG|Lösung)\s*\d*/gi)];
  console.log('Number of LÖSUNG markers:', loesungMatches.length);
  
  // Check the first LÖSUNG section
  const firstLoesungIndex = html.search(/LÖSUNG\s*1/i);
  if (firstLoesungIndex > 0) {
    const afterLoesung = html.substring(firstLoesungIndex, firstLoesungIndex + 2000);
    console.log('\n=== HTML after LÖSUNG 1 (2000 chars): ===');
    console.log(afterLoesung);
    console.log('\n--- Contains table after LÖSUNG 1:', afterLoesung.includes('<table'));
  }
  
  // Also check if the "Beispieltabelle" is in a table
  const beispielIndex = html.indexOf('Beispieltabelle');
  if (beispielIndex > 0) {
    console.log('\n=== HTML around Beispieltabelle (1500 chars): ===');
    console.log(html.substring(beispielIndex - 100, beispielIndex + 1400));
  }
}

check();
