/**
 * PDF Upload Script for Supabase Storage
 * 
 * Usage: node scripts/upload-pdfs-to-supabase.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONTENT_IMPORT_PATH = path.join(__dirname, '..', 'content_import');
const OUTPUT_CSV_PATH = path.join(__dirname, '..', 'pdf_mapping.csv');
const OUTPUT_JSON_PATH = path.join(__dirname, '..', 'pdf_mapping.json');

// Supabase configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'content';

// Sanitize folder/file names for URL-safe storage paths
function sanitizePath(name) {
    return name
        .replace(/[äÄ]/g, 'ae')
        .replace(/[öÖ]/g, 'oe')
        .replace(/[üÜ]/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[§]/g, 'par')
        .replace(/[^\w\s\-\.]/g, '')
        .replace(/\s+/g, '_')
        .trim();
}

// Scan directory for all PDFs
function scanForPdfs() {
    const pdfs = [];

    // Read component folders
    const componentFolders = fs.readdirSync(CONTENT_IMPORT_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory());

    for (const componentDir of componentFolders) {
        const componentName = componentDir.name;
        const componentPath = path.join(CONTENT_IMPORT_PATH, componentName);

        // Read enabler folders within component
        let enablerFolders;
        try {
            enablerFolders = fs.readdirSync(componentPath, { withFileTypes: true })
                .filter(d => d.isDirectory());
        } catch (e) {
            console.warn(`  Skipping ${componentName}: ${e.message}`);
            continue;
        }

        for (const enablerDir of enablerFolders) {
            const enablerName = enablerDir.name;
            const enablerPath = path.join(componentPath, enablerName);

            // Find PDF files (ignore .docx, .doc)
            let files;
            try {
                files = fs.readdirSync(enablerPath);
            } catch (e) {
                continue;
            }
            const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

            for (const pdfFile of pdfFiles) {
                const localPath = path.join(enablerPath, pdfFile);
                let stats;
                try {
                    stats = fs.statSync(localPath);
                } catch (e) {
                    continue;
                }

                // Create sanitized storage path
                const sanitizedComponent = sanitizePath(componentName);
                const sanitizedEnabler = sanitizePath(enablerName);
                const sanitizedFileName = sanitizePath(pdfFile);
                const storagePath = `enablers/${sanitizedComponent}/${sanitizedEnabler}/${sanitizedFileName}`;

                pdfs.push({
                    componentName,
                    enablerName,
                    pdfFileName: pdfFile,
                    localPath,
                    storagePath,
                    sizeBytes: stats.size,
                    publicUrl: null,
                });
            }
        }
    }

    return pdfs;
}

// Upload a single PDF to Supabase Storage
async function uploadPdf(supabase, pdf) {
    try {
        const fileBuffer = fs.readFileSync(pdf.localPath);

        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(pdf.storagePath, fileBuffer, {
                contentType: 'application/pdf',
                upsert: true,
            });

        if (error) {
            console.error(`  ❌ Failed: ${error.message}`);
            return null;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(pdf.storagePath);

        return urlData.publicUrl;
    } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
        return null;
    }
}

// Generate CSV for Excel import
function generateCsv(pdfs) {
    const header = 'component_name,enabler_name,pdf_title,pdf_url,pdf_filename';
    const rows = pdfs.map(pdf => {
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        const title = pdf.pdfFileName.replace(/\.pdf$/i, '');
        return [
            escape(pdf.componentName),
            escape(pdf.enablerName),
            escape(title),
            escape(pdf.publicUrl || ''),
            escape(pdf.pdfFileName),
        ].join(',');
    });

    return [header, ...rows].join('\n');
}

// Main execution
async function main() {
    console.log('🔍 Scanning for PDFs...\n');

    const pdfs = scanForPdfs();
    const componentCount = new Set(pdfs.map(p => p.componentName)).size;

    console.log(`📊 Found ${pdfs.length} PDFs across ${componentCount} components\n`);

    // Group by component for summary
    const byComponent = {};
    pdfs.forEach(pdf => {
        byComponent[pdf.componentName] = (byComponent[pdf.componentName] || 0) + 1;
    });

    console.log('📁 PDFs per component:');
    Object.entries(byComponent).forEach(([comp, count]) => {
        const shortName = comp.length > 55 ? comp.substring(0, 55) + '...' : comp;
        console.log(`   ${String(count).padStart(2)} PDFs - ${shortName}`);
    });

    // Calculate total size
    const totalBytes = pdfs.reduce((sum, p) => sum + p.sizeBytes, 0);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    console.log(`\n📦 Total size: ${totalMB} MB`);

    // Check Supabase credentials
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.log('\n⚠️  Supabase credentials not found in environment.');
        console.log('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n');
        console.log('📄 Generating local mapping file without URLs...');

        const csv = generateCsv(pdfs);
        fs.writeFileSync(OUTPUT_CSV_PATH, csv);
        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(pdfs, null, 2));

        console.log(`\n✅ Generated:\n   - ${OUTPUT_CSV_PATH}\n   - ${OUTPUT_JSON_PATH}`);
        console.log('\n💡 To upload, run with environment variables:');
        console.log('   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=yyy node scripts/upload-pdfs-to-supabase.mjs');
        return;
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log('\n🚀 Uploading PDFs to Supabase Storage...\n');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pdfs.length; i++) {
        const pdf = pdfs[i];
        const shortName = pdf.enablerName.length > 40 ? pdf.enablerName.substring(0, 40) + '...' : pdf.enablerName;
        process.stdout.write(`[${String(i + 1).padStart(3)}/${pdfs.length}] ${shortName} `);

        const url = await uploadPdf(supabase, pdf);
        if (url) {
            pdf.publicUrl = url;
            successCount++;
            console.log('✅');
        } else {
            failCount++;
        }
    }

    console.log(`\n📊 Upload complete: ${successCount} success, ${failCount} failed`);

    // Generate output files
    const csv = generateCsv(pdfs.filter(p => p.publicUrl));
    fs.writeFileSync(OUTPUT_CSV_PATH, csv);
    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(pdfs, null, 2));

    console.log(`\n✅ Generated mapping files:`);
    console.log(`   - ${OUTPUT_CSV_PATH} (for Excel import)`);
    console.log(`   - ${OUTPUT_JSON_PATH} (full details)`);
}

main().catch(console.error);
