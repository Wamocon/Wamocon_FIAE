/**
 * PDF Upload Script for Supabase Storage
 * 
 * This script:
 * 1. Scans the content_import folder for all PDFs
 * 2. Uploads them to Supabase Storage bucket "content"
 * 3. Generates a CSV mapping file for Excel import
 * 
 * Usage: npx ts-node scripts/upload-pdfs-to-supabase.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Configuration
const CONTENT_IMPORT_PATH = path.join(__dirname, '..', 'content_import');
const OUTPUT_CSV_PATH = path.join(__dirname, '..', 'pdf_mapping.csv');
const OUTPUT_JSON_PATH = path.join(__dirname, '..', 'pdf_mapping.json');

// Supabase configuration - use environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'content';

interface PdfInfo {
  componentName: string;
  enablerName: string;
  pdfFileName: string;
  localPath: string;
  storagePath: string;
  publicUrl?: string;
  sizeBytes: number;
}

// Sanitize folder/file names for URL-safe storage paths
function sanitizePath(name: string): string {
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
function scanForPdfs(): PdfInfo[] {
  const pdfs: PdfInfo[] = [];
  
  // Read component folders
  const componentFolders = fs.readdirSync(CONTENT_IMPORT_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory());
  
  for (const componentDir of componentFolders) {
    const componentName = componentDir.name;
    const componentPath = path.join(CONTENT_IMPORT_PATH, componentName);
    
    // Read enabler folders within component
    const enablerFolders = fs.readdirSync(componentPath, { withFileTypes: true })
      .filter(d => d.isDirectory());
    
    for (const enablerDir of enablerFolders) {
      const enablerName = enablerDir.name;
      const enablerPath = path.join(componentPath, enablerName);
      
      // Find PDF files (ignore .docx, .doc)
      const files = fs.readdirSync(enablerPath);
      const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
      
      for (const pdfFile of pdfFiles) {
        const localPath = path.join(enablerPath, pdfFile);
        const stats = fs.statSync(localPath);
        
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
        });
      }
    }
  }
  
  return pdfs;
}

// Upload a single PDF to Supabase Storage
async function uploadPdf(
  supabase: ReturnType<typeof createClient>,
  pdf: PdfInfo
): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(pdf.localPath);
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(pdf.storagePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true, // Overwrite if exists
      });
    
    if (error) {
      console.error(`  ❌ Failed to upload ${pdf.pdfFileName}: ${error.message}`);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(pdf.storagePath);
    
    return urlData.publicUrl;
  } catch (err: any) {
    console.error(`  ❌ Error uploading ${pdf.pdfFileName}: ${err.message}`);
    return null;
  }
}

// Generate CSV for Excel import
function generateCsv(pdfs: PdfInfo[]): string {
  const header = 'component_name,enabler_name,pdf_title,pdf_url,pdf_filename';
  const rows = pdfs.map(pdf => {
    // Escape CSV fields
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
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
  
  console.log(`📊 Found ${pdfs.length} PDFs across ${new Set(pdfs.map(p => p.componentName)).size} components\n`);
  
  // Group by component for summary
  const byComponent = pdfs.reduce((acc, pdf) => {
    acc[pdf.componentName] = (acc[pdf.componentName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('📁 PDFs per component:');
  Object.entries(byComponent).forEach(([comp, count]) => {
    console.log(`   ${count} PDFs - ${comp.substring(0, 50)}...`);
  });
  
  // Check Supabase credentials
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('\n⚠️  Supabase credentials not found in environment.');
    console.log('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    console.log('\n📄 Generating local mapping file without URLs...');
    
    // Generate CSV/JSON without URLs for reference
    const csv = generateCsv(pdfs);
    fs.writeFileSync(OUTPUT_CSV_PATH, csv);
    fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(pdfs, null, 2));
    
    console.log(`\n✅ Generated:\n   - ${OUTPUT_CSV_PATH}\n   - ${OUTPUT_JSON_PATH}`);
    return;
  }
  
  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  console.log('\n🚀 Uploading PDFs to Supabase Storage...\n');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    process.stdout.write(`[${i + 1}/${pdfs.length}] Uploading: ${pdf.enablerName.substring(0, 40)}... `);
    
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
