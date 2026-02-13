import mammoth from 'mammoth';
import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = 'D:/FIAE UI/Wamocon_FIAE/Szenarien';

async function findTablesInDocx() {
  const allDocx: string[] = [];
  
  function scanDir(dir: string) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scanDir(full);
        } else if (item.endsWith('.docx') && !item.startsWith('~')) {
          allDocx.push(full);
        }
      }
    } catch (e) {}
  }
  
  scanDir(BASE_DIR);
  console.log(`Total DOCX files found: ${allDocx.length}\n`);
  
  const withTables: { file: string; course: string; enabler: string }[] = [];
  
  for (const file of allDocx) {
    try {
      const html = await mammoth.convertToHtml({ path: file });
      if (html.value.includes('<table')) {
        const rel = file.replace(BASE_DIR + '/', '').replace(BASE_DIR + '\\', '');
        const parts = rel.split(/[\/\\]/);
        // Extract course number (K01, K02, etc)
        const courseMatch = parts[0]?.match(/^(K\d+)/);
        withTables.push({
          file: parts[parts.length - 1],
          course: courseMatch ? courseMatch[1] : parts[0],
          enabler: parts[1] || ''
        });
      }
    } catch (e) {
      // Skip corrupt files
    }
  }
  
  console.log(`\n=== SCENARIOS WITH TABLES (${withTables.length} files) ===\n`);
  
  // Group by course and enabler
  const byEnabler = new Map<string, string[]>();
  for (const item of withTables) {
    const key = `${item.course} | ${item.enabler}`;
    if (!byEnabler.has(key)) byEnabler.set(key, []);
    byEnabler.get(key)!.push(item.file);
  }
  
  // Sort by course number
  const sortedKeys = Array.from(byEnabler.keys()).sort((a, b) => {
    const numA = parseInt(a.match(/K(\d+)/)?.[1] || '0');
    const numB = parseInt(b.match(/K(\d+)/)?.[1] || '0');
    return numA - numB;
  });
  
  console.log('Course | Enabler | File(s)');
  console.log('-------|---------|--------');
  
  for (const key of sortedKeys) {
    const files = byEnabler.get(key)!;
    const [course, enabler] = key.split(' | ');
    // Clean enabler name
    const cleanEnabler = enabler.replace(/^\d+_\d+[_\s]+/, '').substring(0, 45);
    for (const file of files) {
      console.log(`${course} | ${cleanEnabler}... | ${file}`);
    }
  }
  
  process.exit(0);
}

findTablesInDocx();
