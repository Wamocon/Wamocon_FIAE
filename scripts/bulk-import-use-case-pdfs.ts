/**
 * Bulk Import Use Case PDFs
 * 
 * This script scans a folder structure for Use Case PDFs and:
 * 1. Uploads them to Supabase Storage
 * 2. Creates contentDocuments entries linked to use cases
 * 3. Triggers HAI ingestion for TRAINER_SOLUTION documents
 * 
 * Expected folder structure (configurable via CONFIG below):
 * 
 *   use_cases_import/
 *   ├── K1_Use-Cases/          (Kapitel/Kompetenz 1)
 *   │   ├── 1a/                (Use Case identifier)
 *   │   │   ├── *_Use-Case_*.pdf           → TRAINER_SOLUTION (full)
 *   │   │   └── *_Use-Case_*_Fragen.pdf    → TRAINEE_QUESTION (questions only)
 *   │   └── 1b/
 *   │       └── ...
 *   ├── K2_Use-Cases/
 *   │   └── ...
 *   └── ...
 * 
 * Run with:
 *   npx tsx scripts/bulk-import-use-case-pdfs.ts [--dry-run] [--hai-skip]
 * 
 * Options:
 *   --dry-run    Preview changes without uploading or modifying database
 *   --hai-skip   Skip HAI ingestion (faster imports, ingest later)
 *   --qa         Use QA environment (default is production-like based on .env)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local (Next.js style) with override to ensure it takes precedence
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import db from '../src/db';
import { contentDocuments, useCases, courses } from '../src/db/migrations/schemas/schema';
import { eq, ilike, and, or, sql } from 'drizzle-orm';

// ==========================================
// CONFIGURATION - Modify these as needed
// ==========================================
const CONFIG = {
    // Base folder containing the use case PDFs
    // Can be relative to project root or absolute path
    importFolder: './use_cases_import',
    
    // Folder naming pattern for component/chapter (K1, K2, etc.)
    // Supports both K1_Use-Cases (hyphen) and K3_Use_Cases (underscore)
    // The number will be extracted and matched to course.chapter
    componentFolderPattern: /^K(\d+)[_-]Use[_-]Cases$/i,
    
    // Subfolder naming pattern for use case (1a, 1b, 2a, etc.)
    // Supports both simple (1a) and descriptive (9c_Use-Case_...) names
    // Extracts the code from the beginning of the folder name
    useCaseFolderPattern: /^(\d+)([a-z])/i,
    
    // PDF filename patterns
    // TRAINER_SOLUTION: Full PDF with answers (anything without "Fragen" suffix)
    // TRAINEE_QUESTION: Questions-only PDF (has "_Fragen" before extension)
    questionSuffix: '_Fragen.pdf',
    
    // Supabase Storage bucket name
    storageBucket: 'content',
    
    // Storage path prefix for use case documents
    storagePrefix: 'use-cases',
    
    // Default trainer ID for uploadedById (can be overridden)
    // If not set, will try to find first TRAINER in database
    defaultTrainerId: null as string | null,
    
    // Whether to trigger HAI ingestion for new TRAINER_SOLUTION documents
    enableHaiIngestion: true,
    
    // Batch size for parallel uploads
    uploadBatchSize: 5,
    
    // Delay between batches (ms) to avoid rate limiting
    batchDelayMs: 500,
};

// ==========================================
// TYPES
// ==========================================
interface PdfFile {
    fullPath: string;
    fileName: string;
    componentCode: string;  // e.g., "K1"
    componentNumber: number; // e.g., 1
    useCaseCode: string;    // e.g., "1a"
    documentType: 'TRAINER_SOLUTION' | 'TRAINEE_QUESTION';
    sizeBytes: number;
}

interface ImportResult {
    success: boolean;
    file: PdfFile;
    useCaseId?: string;
    documentId?: string;
    storageUrl?: string;
    error?: string;
}

interface ImportSummary {
    totalFiles: number;
    uploaded: number;
    skipped: number;
    failed: number;
    haiIngested: number;
    results: ImportResult[];
}

// ==========================================
// CLI ARGUMENT PARSING
// ==========================================
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HAI_SKIP = args.includes('--hai-skip');
const USE_QA = args.includes('--qa');
const SCAN_ONLY = args.includes('--scan-only'); // Just scan files, no database needed

// Phase/batch processing: --phase=N --batch-size=M
const phaseArg = args.find(a => a.startsWith('--phase='));
const PHASE = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : null;
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 6;

// Component filter: --components=K1,K2,K3
const componentsArg = args.find(a => a.startsWith('--components='));
const COMPONENT_FILTER = componentsArg 
    ? componentsArg.split('=')[1].split(',').map(c => c.trim().toUpperCase())
    : null;

// ==========================================
// FILENAME SANITIZATION
// ==========================================
/**
 * Sanitize filename for Supabase Storage (no special characters allowed)
 * Converts German umlauts and special characters to ASCII equivalents
 */
function sanitizeFilenameForStorage(filename: string): string {
    return filename
        .replace(/ä/g, 'ae')
        .replace(/Ä/g, 'Ae')
        .replace(/ö/g, 'oe')
        .replace(/Ö/g, 'Oe')
        .replace(/ü/g, 'ue')
        .replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss')
        .replace(/[^\w\s\-_.()]/g, '') // Remove any other special chars
        .replace(/\s+/g, '_'); // Replace spaces with underscores
}

// ==========================================
// SUPABASE CLIENT
// ==========================================
function getSupabaseClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
    }
    
    return createClient(supabaseUrl, supabaseKey);
}

// ==========================================
// FOLDER SCANNING
// ==========================================

/**
 * Find the actual content folder, handling nested structures like K1_Use-Cases/K1_Use-Cases/
 */
function findContentFolder(basePath: string): string {
    const items = fs.readdirSync(basePath, { withFileTypes: true });
    
    // Check if there's a nested folder with the same name pattern
    for (const item of items) {
        if (item.isDirectory() && CONFIG.componentFolderPattern.test(item.name)) {
            // Found nested component folder, recurse into it
            return findContentFolder(path.join(basePath, item.name));
        }
    }
    
    // Check if any subfolder matches use case pattern - if so, we're at the right level
    const hasUseCaseFolders = items.some(
        item => item.isDirectory() && CONFIG.useCaseFolderPattern.test(item.name)
    );
    
    if (hasUseCaseFolders) {
        return basePath;
    }
    
    // No use case folders found, check one level deeper for each subfolder
    for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'Archiv') {
            const subItems = fs.readdirSync(path.join(basePath, item.name), { withFileTypes: true });
            const subHasUseCases = subItems.some(
                si => si.isDirectory() && CONFIG.useCaseFolderPattern.test(si.name)
            );
            if (subHasUseCases) {
                return path.join(basePath, item.name);
            }
        }
    }
    
    return basePath;
}

/**
 * Extract use case code from folder name
 * Handles multiple formats:
 * - Simple: "1a", "10b", "23c"
 * - With prefix: "9c_Use-Case_Description"
 * - Alternative: "Use Cases_6d-...", "Use-Case_19b_...", "Use case_25a-..."
 */
function extractUseCaseCode(folderName: string): string | null {
    // Pattern 1: Starts with code (1a, 10b, etc.)
    const directMatch = folderName.match(/^(\d+)([a-z])/i);
    if (directMatch) {
        return `${directMatch[1]}${directMatch[2].toLowerCase()}`;
    }
    
    // Pattern 2: "Use Case_XX" or "Use Cases_XX" or "Use-Case_XX" format
    const useCaseMatch = folderName.match(/Use[_\s-]?Cases?[_\s-](\d+)([a-z])/i);
    if (useCaseMatch) {
        return `${useCaseMatch[1]}${useCaseMatch[2].toLowerCase()}`;
    }
    
    return null;
}

function scanForPdfs(baseFolder: string): PdfFile[] {
    const files: PdfFile[] = [];
    const absoluteBase = path.resolve(baseFolder);
    
    if (!fs.existsSync(absoluteBase)) {
        throw new Error(`Import folder does not exist: ${absoluteBase}`);
    }
    
    console.log(`📁 Scanning folder: ${absoluteBase}\n`);
    
    // Scan component folders (K1_Use-Cases, K2_Use_Cases, etc.)
    const topLevelFolders = fs.readdirSync(absoluteBase, { withFileTypes: true })
        .filter(d => d.isDirectory() && CONFIG.componentFolderPattern.test(d.name));
    
    console.log(`Found ${topLevelFolders.length} component folders\n`);
    
    for (const compFolder of topLevelFolders) {
        const match = compFolder.name.match(CONFIG.componentFolderPattern);
        if (!match) continue;
        
        const componentNumber = parseInt(match[1], 10);
        const componentCode = `K${componentNumber}`;
        const compPath = path.join(absoluteBase, compFolder.name);
        
        // Find the actual content folder (handles nested structures)
        const contentPath = findContentFolder(compPath);
        
        console.log(`  📂 ${compFolder.name} (Component: ${componentCode})`);
        if (contentPath !== compPath) {
            console.log(`     ↳ Content in: ${path.relative(compPath, contentPath) || '.'}`);
        }
        
        // Scan use case subfolders
        const useCaseFolders = fs.readdirSync(contentPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'Archiv');
        
        let componentFileCount = 0;
        
        for (const ucFolder of useCaseFolders) {
            const useCaseCode = extractUseCaseCode(ucFolder.name);
            if (!useCaseCode) {
                console.log(`     ⚠️ Skipping folder (no code match): ${ucFolder.name}`);
                continue;
            }
            
            const ucPath = path.join(contentPath, ucFolder.name);
            
            // Find PDF files in this folder
            const pdfFiles = fs.readdirSync(ucPath, { withFileTypes: true })
                .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.pdf'));
            
            for (const pdfFile of pdfFiles) {
                const fullPath = path.join(ucPath, pdfFile.name);
                const stats = fs.statSync(fullPath);
                
                // Determine document type based on filename
                // Handles both "_Fragen" and "-Fragen" patterns
                const lowerName = pdfFile.name.toLowerCase();
                const isQuestion = lowerName.includes('_fragen') || lowerName.includes('-fragen');
                const documentType = isQuestion ? 'TRAINEE_QUESTION' : 'TRAINER_SOLUTION';
                
                files.push({
                    fullPath,
                    fileName: pdfFile.name,
                    componentCode,
                    componentNumber,
                    useCaseCode,
                    documentType,
                    sizeBytes: stats.size,
                });
                componentFileCount++;
            }
            
            const fileCount = pdfFiles.length;
            if (fileCount > 0) {
                console.log(`     └─ ${useCaseCode}: ${fileCount} PDF(s)`);
            }
        }
        
        console.log(`     Total: ${componentFileCount} PDFs\n`);
    }
    
    return files;
}

// ==========================================
// USE CASE MATCHING/CREATION
// ==========================================
async function findOrCreateUseCase(
    componentNumber: number,
    useCaseCode: string,
    trainerId: string
): Promise<{ id: string; title: string; courseId: string } | null> {
    // First, find the course that matches this component (Kapitel/chapter)
    // We look for courses with chapter = componentNumber
    const [course] = await db
        .select({ id: courses.id, title: courses.title })
        .from(courses)
        .where(eq(courses.chapter, componentNumber))
        .limit(1);
    
    if (!course) {
        console.warn(`   ⚠️ No course found for chapter ${componentNumber}`);
        
        // Try alternative: find course with "Kapitel ${componentNumber}" in title
        const [courseByTitle] = await db
            .select({ id: courses.id, title: courses.title })
            .from(courses)
            .where(ilike(courses.title, `%Kapitel ${componentNumber}%`))
            .limit(1);
        
        if (!courseByTitle) {
            return null;
        }
        
        return await findOrCreateUseCaseInCourse(courseByTitle.id, useCaseCode, trainerId);
    }
    
    return await findOrCreateUseCaseInCourse(course.id, useCaseCode, trainerId);
}

async function findOrCreateUseCaseInCourse(
    courseId: string,
    useCaseCode: string,
    trainerId: string
): Promise<{ id: string; title: string; courseId: string } | null> {
    // Try to find existing use case by matching the code pattern
    // The use case title or description might contain the code (e.g., "1a", "Use Case 1a")
    const existingUseCases = await db
        .select({ id: useCases.id, title: useCases.title })
        .from(useCases)
        .where(eq(useCases.courseId, courseId as any));
    
    // Find a match by code in title
    const codePattern = new RegExp(`\\b${useCaseCode}\\b`, 'i');
    const matchByTitle = existingUseCases.find(uc => 
        codePattern.test(uc.title) || 
        uc.title.toLowerCase().includes(`use case ${useCaseCode}`) ||
        uc.title.toLowerCase().includes(`usecase ${useCaseCode}`)
    );
    
    if (matchByTitle) {
        return { ...matchByTitle, courseId };
    }
    
    // Try matching by order index (1a = index 1 with letter 'a')
    const codeMatch = useCaseCode.match(/^(\d+)([a-z])$/i);
    if (codeMatch) {
        const baseNumber = parseInt(codeMatch[1], 10);
        const letterIndex = codeMatch[2].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
        const targetIndex = (baseNumber - 1) * 26 + letterIndex + 1; // Convert to linear index
        
        // Try finding by orderIndex
        const [matchByIndex] = await db
            .select({ id: useCases.id, title: useCases.title })
            .from(useCases)
            .where(and(
                eq(useCases.courseId, courseId as any),
                eq(useCases.orderIndex, targetIndex)
            ))
            .limit(1);
        
        if (matchByIndex) {
            return { ...matchByIndex, courseId };
        }
    }
    
    // If no match found, create a new use case (in non-dry-run mode)
    if (!DRY_RUN) {
        // Get next order index
        const maxIndexResult = await db
            .select({ maxIndex: sql<number>`COALESCE(MAX(${useCases.orderIndex}), 0)` })
            .from(useCases)
            .where(eq(useCases.courseId, courseId as any));
        
        const nextIndex = (maxIndexResult[0]?.maxIndex ?? 0) + 1;
        
        const [newUseCase] = await db
            .insert(useCases)
            .values({
                courseId: courseId as any,
                title: `Use Case ${useCaseCode.toUpperCase()}`,
                descriptionText: `Imported use case ${useCaseCode}`,
                orderIndex: nextIndex,
                isActive: true,
            })
            .returning({ id: useCases.id, title: useCases.title });
        
        console.log(`   ✨ Created new use case: ${newUseCase.title}`);
        return { ...newUseCase, courseId };
    }
    
    console.log(`   📝 [DRY-RUN] Would create use case: Use Case ${useCaseCode.toUpperCase()}`);
    return { id: 'dry-run-id', title: `Use Case ${useCaseCode.toUpperCase()}`, courseId };
}

// ==========================================
// PDF UPLOAD
// ==========================================
async function uploadPdfToStorage(
    supabase: any, // Using any to avoid SupabaseClient generic type issues
    file: PdfFile
): Promise<{ url: string; path: string } | null> {
    // Sanitize filename for storage (Supabase doesn't allow special characters)
    const sanitizedFileName = sanitizeFilenameForStorage(file.fileName);
    
    if (DRY_RUN) {
        const storagePath = `${CONFIG.storagePrefix}/${file.componentCode}/${file.useCaseCode}/${sanitizedFileName}`;
        return {
            url: `https://[supabase-url]/storage/v1/object/public/${CONFIG.storageBucket}/${storagePath}`,
            path: storagePath,
        };
    }
    
    const fileBuffer = fs.readFileSync(file.fullPath);
    const storagePath = `${CONFIG.storagePrefix}/${file.componentCode}/${file.useCaseCode}/${sanitizedFileName}`;
    
    // Check if file already exists
    const { data: existingFile } = await supabase.storage
        .from(CONFIG.storageBucket)
        .list(`${CONFIG.storagePrefix}/${file.componentCode}/${file.useCaseCode}`, {
            search: sanitizedFileName,
        });
    
    if (existingFile && existingFile.length > 0) {
        const existingMatch = existingFile.find((f: { name: string }) => f.name === sanitizedFileName);
        if (existingMatch) {
            console.log(`   ⏭️ File already exists: ${storagePath}`);
            const { data: urlData } = supabase.storage
                .from(CONFIG.storageBucket)
                .getPublicUrl(storagePath);
            return { url: urlData.publicUrl, path: storagePath };
        }
    }
    
    const { data, error } = await supabase.storage
        .from(CONFIG.storageBucket)
        .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: false, // Don't overwrite existing files
        });
    
    if (error) {
        if (error.message.includes('already exists')) {
            const { data: urlData } = supabase.storage
                .from(CONFIG.storageBucket)
                .getPublicUrl(storagePath);
            return { url: urlData.publicUrl, path: storagePath };
        }
        throw new Error(`Storage upload failed: ${error.message}`);
    }
    
    const { data: urlData } = supabase.storage
        .from(CONFIG.storageBucket)
        .getPublicUrl(storagePath);
    
    return { url: urlData.publicUrl, path: storagePath };
}

// ==========================================
// DATABASE RECORD CREATION
// ==========================================
async function createDocumentRecord(
    file: PdfFile,
    useCaseId: string,
    storageUrl: string,
    storagePath: string,
    trainerId: string
): Promise<string | null> {
    if (DRY_RUN) {
        return 'dry-run-doc-id';
    }
    
    // Check if document already exists
    const [existingDoc] = await db
        .select({ id: contentDocuments.id })
        .from(contentDocuments)
        .where(and(
            eq(contentDocuments.useCaseId, useCaseId as any),
            eq(contentDocuments.fileName, file.fileName)
        ))
        .limit(1);
    
    if (existingDoc) {
        console.log(`   ⏭️ Document record already exists: ${file.fileName}`);
        return existingDoc.id;
    }
    
    // Determine visibility based on document type
    const visibility = file.documentType === 'TRAINER_SOLUTION' ? 'TRAINER_ONLY' : 'ALL';
    
    const [doc] = await db
        .insert(contentDocuments)
        .values({
            useCaseId: useCaseId as any,
            title: file.fileName.replace('.pdf', ''),
            description: `Imported ${file.documentType === 'TRAINER_SOLUTION' ? 'solution' : 'questions'} document`,
            documentType: file.documentType as any,
            visibility: visibility as any,
            fileName: file.fileName,
            fileSize: file.sizeBytes,
            mimeType: 'application/pdf',
            storageUrl,
            storagePath,
            uploadedById: trainerId as any,
        })
        .returning({ id: contentDocuments.id });
    
    return doc.id;
}

// ==========================================
// HAI INGESTION
// ==========================================
async function triggerHaiIngestion(
    useCaseId: string,
    documentId: string
): Promise<boolean> {
    if (DRY_RUN || HAI_SKIP || !CONFIG.enableHaiIngestion) {
        return false;
    }
    
    try {
        const { ingestUseCaseDocument } = await import('../src/lib/hai/ingestUseCase');
        const result = await ingestUseCaseDocument(useCaseId, documentId, false);
        
        if (result.success) {
            console.log(`   🤖 HAI indexed: ${result.chunksIndexed} chunks, ${result.pagesProcessed} pages`);
            return true;
        } else {
            console.warn(`   ⚠️ HAI ingestion failed: ${result.error}`);
            return false;
        }
    } catch (err) {
        console.warn(`   ⚠️ HAI ingestion error: ${err}`);
        return false;
    }
}

// ==========================================
// FIND DEFAULT TRAINER
// ==========================================
async function findDefaultTrainer(): Promise<string | null> {
    if (CONFIG.defaultTrainerId) {
        return CONFIG.defaultTrainerId;
    }
    
    // Import profiles to find a trainer
    const { profiles } = await import('../src/db/migrations/schemas/schema');
    
    const [trainer] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.role, 'TRAINER'))
        .limit(1);
    
    return trainer?.id ?? null;
}

// ==========================================
// BATCH PROCESSING
// ==========================================
function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// MAIN IMPORT FUNCTION
// ==========================================
async function importUseCasePdfs(): Promise<ImportSummary> {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║       BULK USE CASE PDF IMPORTER                                 ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    if (SCAN_ONLY) {
        console.log('📋 SCAN ONLY MODE - Just analyzing folder structure\n');
    } else if (DRY_RUN) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    if (HAI_SKIP) {
        console.log('⏭️ HAI INGESTION SKIPPED\n');
    }
    
    const summary: ImportSummary = {
        totalFiles: 0,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        haiIngested: 0,
        results: [],
    };
    
    try {
        // Scan for PDF files first (doesn't need database)
        const files = scanForPdfs(CONFIG.importFolder);
        summary.totalFiles = files.length;
        
        console.log(`\n📊 Found ${files.length} PDF files to import`);
        
        // Group by document type for summary
        const solutions = files.filter(f => f.documentType === 'TRAINER_SOLUTION');
        const questions = files.filter(f => f.documentType === 'TRAINEE_QUESTION');
        console.log(`   - ${solutions.length} TRAINER_SOLUTION (full PDFs)`);
        console.log(`   - ${questions.length} TRAINEE_QUESTION (questions only)\n`);
        
        // If scan-only mode, exit here
        if (SCAN_ONLY) {
            console.log('\n📋 SCAN COMPLETE - Use --dry-run or no flags to proceed with import\n');
            return summary;
        }
        
        // In dry-run mode, skip database operations
        let trainerId = 'DRY-RUN-TRAINER-ID';
        let supabase: ReturnType<typeof getSupabaseClient> | null = null;
        
        if (!DRY_RUN) {
            // 1. Find default trainer (requires database)
            const foundTrainer = await findDefaultTrainer();
            if (!foundTrainer) {
                throw new Error('No trainer found in database. Please specify CONFIG.defaultTrainerId');
            }
            trainerId = foundTrainer;
            console.log(`👤 Using trainer ID: ${trainerId}\n`);
            
            // 2. Initialize Supabase client
            supabase = getSupabaseClient();
        } else {
            console.log(`👤 DRY RUN - Skipping database connection\n`);
        }
        
        console.log(`📊 Ready to process ${files.length} PDF files\n`);
        
        if (files.length === 0) {
            console.log('No files to import. Check your folder structure.');
            return summary;
        }
        
        // Group files by component first, then by use case
        const byComponent = new Map<string, Map<string, PdfFile[]>>();
        for (const file of files) {
            if (!byComponent.has(file.componentCode)) {
                byComponent.set(file.componentCode, new Map());
            }
            const compMap = byComponent.get(file.componentCode)!;
            if (!compMap.has(file.useCaseCode)) {
                compMap.set(file.useCaseCode, []);
            }
            compMap.get(file.useCaseCode)!.push(file);
        }
        
        // Sort components by number (K1, K2, ..., K26)
        const sortedComponents = Array.from(byComponent.keys()).sort((a, b) => {
            const numA = parseInt(a.replace('K', ''), 10);
            const numB = parseInt(b.replace('K', ''), 10);
            return numA - numB;
        });
        
        // Apply component filter if specified
        let componentsToProcess = sortedComponents;
        if (COMPONENT_FILTER) {
            componentsToProcess = sortedComponents.filter(c => COMPONENT_FILTER.includes(c));
            console.log(`🎯 COMPONENT FILTER: Processing only ${componentsToProcess.join(', ')}\n`);
        }
        
        // Apply phase filtering if specified
        if (PHASE !== null) {
            const totalPhases = Math.ceil(componentsToProcess.length / BATCH_SIZE);
            if (PHASE < 1 || PHASE > totalPhases) {
                throw new Error(`Invalid phase ${PHASE}. Valid range: 1-${totalPhases}`);
            }
            const startIdx = (PHASE - 1) * BATCH_SIZE;
            const endIdx = Math.min(startIdx + BATCH_SIZE, componentsToProcess.length);
            const phaseComponents = componentsToProcess.slice(startIdx, endIdx);
            
            console.log(`📦 PHASE ${PHASE}/${totalPhases} - Components ${phaseComponents.join(', ')}`);
            console.log(`   (Batch size: ${BATCH_SIZE}, Processing items ${startIdx + 1}-${endIdx} of ${componentsToProcess.length})\n`);
            
            componentsToProcess = phaseComponents;
        }
        
        // Calculate files in this batch
        let batchFileCount = 0;
        for (const comp of componentsToProcess) {
            const compMap = byComponent.get(comp)!;
            for (const [, ucFiles] of compMap) {
                batchFileCount += ucFiles.length;
            }
        }
        
        console.log('─'.repeat(70));
        console.log(`Starting ${DRY_RUN ? 'DRY RUN preview' : 'import'} of ${componentsToProcess.length} components (${batchFileCount} files)...\n`);
        
        let processedComponents = 0;
        let processedFiles = 0;
        
        // Process each component in order
        for (const componentCode of componentsToProcess) {
            processedComponents++;
            const componentNumber = parseInt(componentCode.replace('K', ''), 10);
            const compMap = byComponent.get(componentCode)!;
            const useCaseCodes = Array.from(compMap.keys()).sort();
            
            console.log(`\n${'═'.repeat(70)}`);
            console.log(`📂 COMPONENT ${componentCode} [${processedComponents}/${componentsToProcess.length}]`);
            console.log(`   ${useCaseCodes.length} use cases: ${useCaseCodes.join(', ')}`);
            console.log('─'.repeat(70));
            
            for (const useCaseCode of useCaseCodes) {
                const groupFiles = compMap.get(useCaseCode)!;
                const key = `${componentCode}/${useCaseCode}`;
                
                console.log(`\n📁 Processing ${key} (${groupFiles.length} files)`);
                
                // In dry-run mode, just show what would happen
                if (DRY_RUN) {
                    for (const file of groupFiles) {
                        processedFiles++;
                        console.log(`   📄 [${processedFiles}/${batchFileCount}] ${file.fileName} (${file.documentType})`);
                        console.log(`      ↳ Would upload to: content/use-cases/${key}/${file.fileName}`);
                        summary.uploaded++;
                        summary.results.push({
                            success: true,
                            file,
                            useCaseId: 'dry-run',
                            documentId: 'dry-run',
                            storageUrl: `dry-run://content/use-cases/${key}/${file.fileName}`,
                        });
                        if (file.documentType === 'TRAINER_SOLUTION') {
                            summary.haiIngested++;
                        }
                    }
                    continue;
                }
            
                // Find or create use case
                const useCase = await findOrCreateUseCase(componentNumber, useCaseCode, trainerId);
                
                if (!useCase) {
                    console.log(`   ❌ Could not find/create use case for ${key}`);
                    for (const file of groupFiles) {
                        summary.failed++;
                        summary.results.push({
                            success: false,
                            file,
                            error: 'Use case not found',
                        });
                    }
                    continue;
                }
                
                console.log(`   📋 Use Case: ${useCase.title} (${useCase.id})`);
                
                // Process files in this group
                for (const file of groupFiles) {
                    processedFiles++;
                    try {
                        console.log(`   📄 [${processedFiles}/${batchFileCount}] ${file.fileName} (${file.documentType})`);
                    
                        // Upload to storage
                        const storageResult = await uploadPdfToStorage(supabase, file);
                        if (!storageResult) {
                            throw new Error('Storage upload returned null');
                        }
                    
                        // Create database record
                        const documentId = await createDocumentRecord(
                            file,
                            useCase.id,
                        storageResult.url,
                        storageResult.path,
                        trainerId
                    );
                    
                    if (!documentId) {
                        throw new Error('Document record creation returned null');
                    }
                    
                    // Trigger HAI ingestion for solutions
                    let haiIngested = false;
                    if (file.documentType === 'TRAINER_SOLUTION') {
                        haiIngested = await triggerHaiIngestion(useCase.id, documentId);
                        if (haiIngested) {
                            summary.haiIngested++;
                        }
                    }
                    
                    summary.uploaded++;
                    summary.results.push({
                        success: true,
                        file,
                        useCaseId: useCase.id,
                        documentId,
                        storageUrl: storageResult.url,
                    });
                    
                    console.log(`      ✅ Uploaded successfully`);
                    
                } catch (err) {
                    summary.failed++;
                    summary.results.push({
                        success: false,
                        file,
                        error: String(err),
                    });
                    console.log(`      ❌ Failed: ${err}`);
                }
            }
            
            // Delay between groups
            await delay(CONFIG.batchDelayMs);
            }
            
            // Component complete - show progress
            console.log(`\n✅ Component ${componentCode} complete`);
        }
        
    } catch (err) {
        console.error('\n❌ Fatal error:', err);
    }
    
    // Print summary
    console.log('\n' + '═'.repeat(70));
    console.log('IMPORT SUMMARY');
    if (PHASE !== null) {
        console.log(`Phase: ${PHASE} (batch size: ${BATCH_SIZE})`);
    }
    console.log('═'.repeat(70));
    console.log(`Total files scanned: ${summary.totalFiles}`);
    console.log(`Successfully uploaded: ${summary.uploaded}`);
    console.log(`Skipped (existing): ${summary.skipped}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`HAI indexed: ${summary.haiIngested}`);
    console.log('═'.repeat(70));
    
    if (DRY_RUN) {
        console.log('\n🔍 This was a DRY RUN. Run without --dry-run to import.\n');
    }
    
    // Show next phase hint if running in phases
    if (PHASE !== null) {
        const allComponents = Array.from(new Set(summary.results.map(r => r.file.componentCode)));
        const totalComponents = 26; // Approximate
        const totalPhases = Math.ceil(totalComponents / BATCH_SIZE);
        if (PHASE < totalPhases) {
            console.log(`\n📦 To continue with next phase, run:`);
            console.log(`   npm run import:use-cases -- --phase=${PHASE + 1} --batch-size=${BATCH_SIZE}\n`);
        } else {
            console.log('\n🎉 All phases complete!\n');
        }
    }
    
    return summary;
}

// ==========================================
// ENTRY POINT
// ==========================================
importUseCasePdfs()
    .then((summary) => {
        process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
        console.error('Unhandled error:', err);
        process.exit(1);
    });
