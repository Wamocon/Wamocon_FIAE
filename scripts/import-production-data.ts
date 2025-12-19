/**
 * Production Data Import Script
 * 
 * Imports courses (components), enablers (topics), and PDF documents
 * from pdf_mapping_enhanced.json into the database.
 * 
 * Usage: npx tsx -r dotenv/config scripts/import-production-data.ts
 * 
 * Dry run: npx tsx -r dotenv/config scripts/import-production-data.ts --dry-run
 */

import 'dotenv/config';
import db from '../src/db';
import { courses, enablers, contentDocuments, profiles } from '../src/db/migrations/schemas/schema';
import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';

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

interface ImportStats {
    coursesCreated: number;
    enablersCreated: number;
    documentsCreated: number;
    errors: string[];
}

/**
 * Extract order index from enabler name (e.g., "01_Der Betrieb" -> 1)
 */
function extractOrderIndex(enablerName: string): number {
    const match = enablerName.match(/^(\d+)[_\s-]/);
    if (match) {
        return parseInt(match[1], 10);
    }
    console.warn(`  ⚠️ No order prefix found in: ${enablerName}, defaulting to 0`);
    return 0;
}

/**
 * Clean enabler title (remove order prefix)
 */
function cleanEnablerTitle(enablerName: string): string {
    // Remove patterns like "01_", "01 ", "01-"
    return enablerName.replace(/^\d+[_\s-]+/, '').trim();
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log('📥 Production Data Import Script');
    console.log('================================\n');

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Load the enhanced PDF mapping
    const mappingPath = path.join(__dirname, '..', 'pdf_mapping_enriched.json');

    if (!fs.existsSync(mappingPath)) {
        // Fall back to original mapping if enhanced doesn't exist
        const originalPath = path.join(__dirname, '..', 'pdf_mapping.json');
        if (!fs.existsSync(originalPath)) {
            console.error('❌ No mapping file found. Expected: pdf_mapping_enriched.json or pdf_mapping.json');
            process.exit(1);
        }
        console.log('⚠️ Using original pdf_mapping.json (no descriptions or training year)');
    }

    const actualPath = fs.existsSync(mappingPath) ? mappingPath : path.join(__dirname, '..', 'pdf_mapping.json');
    const mappingData: PdfMappingEntry[] = JSON.parse(fs.readFileSync(actualPath, 'utf-8'));

    console.log(`📊 Loaded ${mappingData.length} entries from mapping file\n`);

    // Group by component
    const byComponent = new Map<string, PdfMappingEntry[]>();
    for (const entry of mappingData) {
        const existing = byComponent.get(entry.componentName) || [];
        existing.push(entry);
        byComponent.set(entry.componentName, existing);
    }

    console.log(`📁 Found ${byComponent.size} unique components (courses)\n`);
    console.log('Components:');
    let idx = 1;
    for (const [comp, entries] of byComponent) {
        console.log(`   ${idx++}. ${comp.substring(0, 60)}... (${entries.length} enablers)`);
    }
    console.log('');

    if (isDryRun) {
        console.log('✅ Dry run complete. Run without --dry-run to import.\n');
        process.exit(0);
    }

    const stats: ImportStats = {
        coursesCreated: 0,
        enablersCreated: 0,
        documentsCreated: 0,
        errors: [],
    };

    // Find a trainer to set as course creator
    const [trainer] = await db.select().from(profiles).where(eq(profiles.role, 'TRAINER')).limit(1);
    if (!trainer) {
        console.error('❌ No trainer found in database. Please create a trainer profile first.');
        process.exit(1);
    }
    console.log(`👤 Using trainer: ${trainer.fullName || trainer.id}\n`);

    // Import courses and enablers
    console.log('🔄 Starting import...\n');

    let courseIndex = 1;
    for (const [componentName, entries] of byComponent) {
        process.stdout.write(`📚 Creating course: ${componentName.substring(0, 50)}... `);

        // Get training year from first entry (all entries in same component should have same year)
        const firstEntry = entries[0];
        const trainingYear = firstEntry.ausbildungsjahr || 1;

        try {
            // Create course
            const [newCourse] = await db.insert(courses).values({
                title: componentName,
                description: `Lernfeld: ${componentName}`,
                year: trainingYear,
                chapter: courseIndex,
                isActive: true,
                createdById: trainer.id,
            }).returning();

            stats.coursesCreated++;
            console.log('✅');

            // Sort entries by order index
            const sortedEntries = entries.sort((a, b) => extractOrderIndex(a.enablerName) - extractOrderIndex(b.enablerName));

            // Create enablers for this course
            for (const entry of sortedEntries) {
                const orderIndex = extractOrderIndex(entry.enablerName);
                const cleanTitle = cleanEnablerTitle(entry.enablerName);
                const description = entry.description?.trim() || null;
                const isActive = entry.isActive !== false; // Default to true

                process.stdout.write(`   📝 Creating enabler: ${cleanTitle.substring(0, 45)}... `);

                try {
                    const [newEnabler] = await db.insert(enablers).values({
                        courseId: newCourse.id,
                        title: cleanTitle,
                        orderIndex: orderIndex,
                        descriptionText: description,
                        isActive: isActive,
                        pptUrl: null, // We'll use content_documents instead
                        videoUrl: null,
                        scenarioText: null,
                        hintText: null,
                        scenarioImageUrl: null,
                        durationValue: null,
                        durationUnit: null,
                    }).returning();

                    stats.enablersCreated++;
                    console.log('✅');

                    // Create content document for PDF (for flipbook viewer)
                    if (entry.publicUrl) {
                        process.stdout.write(`      📄 Linking PDF: ${entry.pdfFileName.substring(0, 35)}... `);

                        try {
                            await db.insert(contentDocuments).values({
                                enablerId: newEnabler.id,
                                title: cleanTitle, // Display title in flipbook
                                description: null,
                                documentType: 'THEORY',
                                fileName: entry.pdfFileName,
                                fileSize: entry.sizeBytes || null,
                                mimeType: 'application/pdf',
                                storageUrl: entry.publicUrl,
                                storagePath: entry.storagePath,
                                orderIndex: 0,
                            });

                            stats.documentsCreated++;
                            console.log('✅');
                        } catch (docError: any) {
                            console.log(`❌ (${docError.message})`);
                            stats.errors.push(`Document for ${entry.enablerName}: ${docError.message}`);
                        }
                    }
                } catch (enablerError: any) {
                    console.log(`❌ (${enablerError.message})`);
                    stats.errors.push(`Enabler ${entry.enablerName}: ${enablerError.message}`);
                }
            }

            courseIndex++;
        } catch (courseError: any) {
            console.log(`❌ (${courseError.message})`);
            stats.errors.push(`Course ${componentName}: ${courseError.message}`);
        }

        console.log(''); // Empty line between courses
    }

    // Summary
    console.log('\n📊 Import Summary');
    console.log('=================');
    console.log(`   Courses created:   ${stats.coursesCreated}`);
    console.log(`   Enablers created:  ${stats.enablersCreated}`);
    console.log(`   Documents linked:  ${stats.documentsCreated}`);

    if (stats.errors.length > 0) {
        console.log(`\n⚠️ Errors (${stats.errors.length}):`);
        stats.errors.forEach(e => console.log(`   - ${e}`));
    } else {
        console.log('\n✅ Import completed successfully with no errors!');
    }

    console.log('\n📝 Next steps:');
    console.log('   1. Verify data in the application');
    console.log('   2. Run quiz import scripts');

    process.exit(0);
}

main().catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
});
