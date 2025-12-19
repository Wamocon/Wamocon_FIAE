/**
 * Enrich PDF Mapping with Descriptions from Excel
 * 
 * This script:
 * 1. Reads the Excel file with enabler descriptions
 * 2. Maps descriptions to pdf_mapping.json entries
 * 3. Enhances descriptions to be learner-friendly
 * 4. Adds Ausbildungsjahr (training year) field
 * 
 * Usage: npx tsx scripts/enrich-descriptions.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface ExcelRow {
    Key: string;
    Summary: string;
    Ausbildungsjahr: string;
    Components: string;
    Description: string;
}

interface PdfMappingEntry {
    componentName: string;
    enablerName: string;
    pdfFileName: string;
    localPath: string;
    storagePath: string;
    sizeBytes: number;
    publicUrl: string;
    description?: string;
    isActive?: boolean;
    ausbildungsjahr?: number | null;
}

/**
 * Extract enabler name from Excel Summary (e.g., "01:\tDer Betrieb" -> "Der Betrieb")
 */
function cleanSummary(summary: string): string {
    return summary
        .replace(/^\d+[:\t\s]+/, '') // Remove "01:" or "01\t" prefix
        .replace(/\t/g, ' ')
        .trim();
}

/**
 * Extract component name from Excel Components field
 * e.g., "24-(§ 4 Abs. 7 Nr. 5) Vernetztes Zusammenarbeiten" -> "Vernetztes Zusammenarbeiten (§ 4 Abs. 7 Nr. 5)"
 */
function cleanComponentName(component: string): string {
    // Remove leading number and dash: "24-" or "01-"
    const withoutNumber = component.replace(/^\d+-/, '').trim();
    return withoutNumber;
}

/**
 * Parse Ausbildungsjahr to number
 */
function parseTrainingYear(year: string | undefined): number | null {
    if (!year) return null;
    if (year.includes('1')) return 1;
    if (year.includes('2')) return 2;
    if (year.toLowerCase().includes('alle')) return null; // Both years
    return null;
}

/**
 * Enhance description to be learner-friendly
 */
function enhanceDescription(rawDesc: string | undefined, enablerTitle: string): string {
    if (!rawDesc || rawDesc.trim().length === 0) {
        return `In diesem Modul lernen Sie die Grundlagen zu "${enablerTitle}".`;
    }

    // Clean up the description
    let desc = rawDesc
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, '\n')
        .replace(/^\*\s*/gm, '• ') // Convert * bullets to •
        .replace(/\[.*?\]/g, '') // Remove any URL references in brackets
        .trim();

    // If description starts with bullet points, add intro
    if (desc.startsWith('•') || desc.startsWith('-') || desc.startsWith('*')) {
        const intro = `In diesem Modul lernen Sie folgende Themen:\n\n`;
        desc = intro + desc;
    } else {
        // Add learning-focused intro
        desc = `In diesem Modul "${enablerTitle}" werden folgende Inhalte behandelt:\n\n${desc}`;
    }

    // Clean up multiple newlines
    desc = desc.replace(/\n{3,}/g, '\n\n');

    return desc;
}

/**
 * Normalize string for comparison (remove special chars, lowercase)
 */
function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/[äÄ]/g, 'a')
        .replace(/[öÖ]/g, 'o')
        .replace(/[üÜ]/g, 'u')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function main() {
    console.log('📊 Enriching PDF Mapping with Descriptions\n');

    // Read Excel file
    const excelPath = path.join(__dirname, '..', 'Excel (Non-Empty Fields) (JIRA) (2).xlsx');
    if (!fs.existsSync(excelPath)) {
        console.error('❌ Excel file not found:', excelPath);
        process.exit(1);
    }

    const wb = XLSX.readFile(excelPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const excelData: ExcelRow[] = XLSX.utils.sheet_to_json(sheet);
    console.log(`📋 Loaded ${excelData.length} rows from Excel\n`);

    // Read PDF mapping
    const mappingPath = path.join(__dirname, '..', 'pdf_mapping.json');
    const pdfMapping: PdfMappingEntry[] = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    console.log(`📁 Loaded ${pdfMapping.length} entries from pdf_mapping.json\n`);

    // Create lookup from Excel data
    // Key: normalized(componentName + enablerTitle)
    const excelLookup = new Map<string, ExcelRow>();

    for (const row of excelData) {
        if (!row.Summary || !row.Components) continue;

        const cleanedSummary = cleanSummary(row.Summary);
        const cleanedComponent = cleanComponentName(row.Components);

        // Create multiple lookup keys for flexible matching
        const key1 = normalize(cleanedComponent + ' ' + cleanedSummary);
        const key2 = normalize(cleanedSummary);

        excelLookup.set(key1, row);
        excelLookup.set(key2, row);
    }

    console.log(`🔑 Created ${excelLookup.size} lookup keys\n`);

    // Match and enrich
    let matched = 0;
    let unmatched = 0;

    for (const entry of pdfMapping) {
        // Clean enabler name (remove order prefix)
        const cleanEnabler = entry.enablerName.replace(/^\d+[_\s-]+/, '').trim();

        // Try different matching strategies
        const key1 = normalize(entry.componentName + ' ' + cleanEnabler);
        const key2 = normalize(cleanEnabler);

        let excelRow = excelLookup.get(key1) || excelLookup.get(key2);

        // Fallback: try partial matching
        if (!excelRow) {
            for (const [key, row] of excelLookup) {
                if (key.includes(normalize(cleanEnabler)) || normalize(cleanEnabler).includes(key.split(' ').slice(-3).join(' '))) {
                    excelRow = row;
                    break;
                }
            }
        }

        if (excelRow) {
            entry.description = enhanceDescription(excelRow.Description, cleanEnabler);
            entry.ausbildungsjahr = parseTrainingYear(excelRow.Ausbildungsjahr);
            matched++;
        } else {
            // Generate default description
            entry.description = `In diesem Modul lernen Sie die Grundlagen zu "${cleanEnabler}".`;
            entry.ausbildungsjahr = null;
            unmatched++;
        }

        entry.isActive = true;
    }

    console.log(`✅ Matched: ${matched}`);
    console.log(`⚠️ Unmatched (default desc): ${unmatched}\n`);

    // Save enriched mapping
    const outputPath = path.join(__dirname, '..', 'pdf_mapping_enriched.json');
    fs.writeFileSync(outputPath, JSON.stringify(pdfMapping, null, 2));
    console.log(`💾 Saved enriched mapping to: pdf_mapping_enriched.json`);

    // Show sample
    console.log('\n📝 Sample enriched entries:\n');
    pdfMapping.slice(0, 3).forEach((entry, i) => {
        console.log(`${i + 1}. ${entry.enablerName}`);
        console.log(`   Component: ${entry.componentName.substring(0, 50)}...`);
        console.log(`   Jahr: ${entry.ausbildungsjahr || 'Alle'}`);
        console.log(`   Desc: ${(entry.description || '').substring(0, 100)}...`);
        console.log('');
    });
}

main().catch(console.error);
