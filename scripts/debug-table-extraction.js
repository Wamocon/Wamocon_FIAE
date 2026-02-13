/**
 * Debug: Test table extraction for specific DOCX
 */
const mammoth = require('mammoth');

const DOCXPath = 'D:/FIAE UI/Wamocon_FIAE/Szenarien/K04_Entwickeln, Erstellen und Betreuen (§4 Absatz 2 Nr 4)/04_08_Grundlagen von relationalen Datenbanken kennen und anwenden können/Szenario parts/Part1_Grundlagen_relationaler_Datenbanken_korrigiert.docx';

function extractAndStyleTables(html) {
  const tableMatches = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  if (!tableMatches) return '';
  
  return tableMatches.map(table => {
    return table
      .replace(/<table/g, '<table class="styled-table"')
      .replace(/<th/g, '<th class="styled-th"')
      .replace(/<td/g, '<td class="styled-td"');
  }).join('\n\n');
}

async function debug() {
  const { value: html } = await mammoth.convertToHtml({ path: DOCXPath });
  const { value: text } = await mammoth.extractRawText({ path: DOCXPath });
  
  // Simulate finding LÖSUNG 1 - FIXED regex (require number + colon)
  const problemNum = 1;
  const loesungHtmlRegex = new RegExp(`(LÖSUNG|Lösung|LOESUNG)\\s*${problemNum}\\s*:`, 'i');
  const loesungHtmlMatch = html.search(loesungHtmlRegex);
  
  console.log('=== DEBUG: Table Extraction for LÖSUNG 1 ===');
  console.log('LÖSUNG regex:', loesungHtmlRegex);
  console.log('loesungHtmlMatch position:', loesungHtmlMatch);
  console.log('HTML at match position:', html.substring(loesungHtmlMatch, loesungHtmlMatch + 100));
  
  if (loesungHtmlMatch >= 0) {
    // Find next PROBLEM marker
    const nextProblemInHtml = html.substring(loesungHtmlMatch).search(/PROBLEM\s*\d+/i);
    console.log('nextProblemInHtml (relative):', nextProblemInHtml);
    
    const loesungEndPos = nextProblemInHtml >= 0 
      ? loesungHtmlMatch + nextProblemInHtml 
      : html.length;
    
    console.log('loesungEndPos (absolute):', loesungEndPos);
    
    const solutionHtml = html.substring(loesungHtmlMatch, loesungEndPos);
    console.log('\nSolution HTML length:', solutionHtml.length);
    console.log('Solution HTML has <table>:', solutionHtml.includes('<table'));
    
    const tables = extractAndStyleTables(solutionHtml);
    console.log('\n=== EXTRACTED TABLES ===');
    console.log('Tables length:', tables.length);
    if (tables) {
      console.log('First 500 chars of tables:', tables.substring(0, 500));
    }
  }
}

debug();
