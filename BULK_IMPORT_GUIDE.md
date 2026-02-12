# Bulk Import Feature - Quick Reference

## 📋 Overview

The bulk import feature allows trainers to import multiple courses, enablers, and use cases at once using an Excel file.

## 🚀 How to Use

### Step 1: Generate Template
```bash
npm run generate:import-template
```
This creates `public/bulk_import_template.xlsx` with all required sheets and instructions.

### Step 2: Fill Template
Open the Excel file and fill in data across these sheets:
- **Instructions**: Read first for guidance
- **Courses**: Course/chapter information
- **Enablers**: Module details linked to courses
- **Use Cases**: Use case descriptions linked to courses
- **Skills**: Optional skills that can be linked to courses

### Step 3: Upload
1. Navigate to `/trainer/bulk-import` in the app
2. Download template (if needed)
3. Upload filled Excel file
4. Review results and error report

## 📊 Excel Structure

### Single File Approach (RECOMMENDED)
**File**: `bulk_import_template.xlsx`

Contains 5 sheets:
1. **Instructions** - How to use the template
2. **Courses** - All courses/chapters
3. **Enablers** - Modules within courses (linked by `course_title`)
4. **Use Cases** - Use cases within courses (linked by `course_title`)
5. **Skills** - Optional skills (linked by `course_titles`)

### Why Single File?
✅ All data in one place
✅ Easy to maintain relationships
✅ Single upload process
✅ Less confusion
✅ Ensures data consistency

## 📄 Sheet Details

### Courses Sheet
| Column | Required | Type | Example |
|--------|----------|------|---------|
| title | ✅ | Text | "Kapitel 1: IT-Grundlagen" |
| description | ❌ | Text | "Einführung in die IT..." |
| year | ❌ | Number | 1 |
| chapter | ❌ | Number | 1 |
| is_active | ❌ | Boolean | TRUE |
| is_published | ❌ | Boolean | TRUE |

### Enablers Sheet
| Column | Required | Type | Example |
|--------|----------|------|---------|
| course_title | ✅ | Text | "Kapitel 1: IT-Grundlagen" |
| title | ✅ | Text | "Netzwerktopologien" |
| order_index | ✅ | Number | 1 |
| description_text | ❌ | Text | "Lernen Sie..." |
| scenario_text | ❌ | Text | "Sie arbeiten..." |
| hint_text | ❌ | Text | "Denken Sie an..." |
| ppt_url | ❌ | URL | "https://..." |
| video_url | ❌ | URL | "https://..." |
| scenario_image_url | ❌ | URL | "https://..." |
| duration_value | ❌ | Number | 120 |
| duration_unit | ❌ | Text | MINUTES/HOURS/DAYS/WEEKS |
| is_active | ❌ | Boolean | TRUE |

### Use Cases Sheet
| Column | Required | Type | Example |
|--------|----------|------|---------|
| course_title | ✅ | Text | "Kapitel 1: IT-Grundlagen" |
| title | ✅ | Text | "Netzwerk einrichten" |
| description_text | ✅ | Text | "Richten Sie ein..." |
| order_index | ✅ | Number | 1 |
| duration_value | ❌ | Number | 240 |
| duration_unit | ❌ | Text | MINUTES/HOURS/DAYS/WEEKS |
| is_active | ❌ | Boolean | TRUE |

### Skills Sheet
| Column | Required | Type | Example |
|--------|----------|------|---------|
| skill_name | ✅ | Text | "Netzwerkkonfiguration" |
| course_titles | ❌ | Text | "Kapitel 1: IT-Grundlagen, Kapitel 2: Programmierung" |

## 🔧 API Endpoint

**Endpoint**: `POST /api/trainer/bulk-import`

**Request**:
```typescript
FormData {
  file: File (Excel .xlsx/.xls)
  trainerId: string
}
```

**Response**:
```typescript
{
  success: boolean;
  message: string;
  stats: {
    coursesCreated: number;
    enablersCreated: number;
    useCasesCreated: number;
    skillsCreated: number;
    errors: string[];
  }
}
```

## ⚠️ Important Rules

### 1. Course Title Matching
- Enablers and Use Cases reference courses by **exact title**
- Case-sensitive and spaces matter
- Example: "Kapitel 1: IT-Grundlagen" (not "Kapitel 1: IT Grundlagen")

### 2. Boolean Values
- Use `TRUE` or `FALSE` (uppercase)
- Not: true/false, 1/0, yes/no

### 3. Duration Units
- Valid: `MINUTES`, `HOURS`, `DAYS`, `WEEKS` (uppercase)
- Invalid: minutes, Hours, days

### 4. Order Index
- Sequential numbers: 1, 2, 3, 4...
- Determines display order in UI

### 5. URLs
- Full URLs starting with `https://`
- For Supabase Storage: Upload files first, then copy public URL

## 📝 Import Process

The system imports in this order:

1. **Skills** (if provided) - Creates skills that can be linked to courses
2. **Courses** - Creates courses and links skills if specified
3. **Enablers** - Creates enablers and links to courses by title
4. **Use Cases** - Creates use cases and links to courses by title

## 🐛 Error Handling

### Partial Success
- If row 5 has an error, rows 1-4 and 6+ still import
- Detailed error report shows which rows failed
- Fix errors and re-upload only failed rows

### Error Examples
```
Enablers row 3: Course "Kapitel 1" not found. Make sure it exists in Courses sheet.
Use Cases row 7: duration_unit "minutes" invalid. Must be MINUTES, HOURS, DAYS, or WEEKS.
Courses row 2: title is required
```

## 💡 Best Practices

### 1. Use Excel Data Validation
- Create dropdowns for:
  - `is_active`, `is_published`: TRUE, FALSE
  - `duration_unit`: MINUTES, HOURS, DAYS, WEEKS
  - `year`: 1, 2, 3

### 2. Color Coding
- Required columns: Yellow background
- Optional columns: White background
- Example rows: Green background

### 3. Testing
- Start with 2-3 rows to test
- Verify data imports correctly
- Then add more bulk data

### 4. Backups
- Save a copy before uploading
- Keep original template for reference

### 5. Incremental Imports
- Import courses first time
- Later add more enablers/use cases
- Use same course titles for linking

## 🔗 File Locations

```
📁 Project Root
├── 📄 scripts/generate-import-template.ts   # Template generator
├── 📁 src/
│   ├── 📁 app/
│   │   ├── 📁 api/
│   │   │   └── 📁 trainer/
│   │   │       └── 📁 bulk-import/
│   │   │           └── 📄 route.ts          # API endpoint
│   │   └── 📁 trainer/
│   │       └── 📁 bulk-import/
│   │           └── 📄 page.tsx              # Upload UI page
│   └── 📁 components/
│       └── 📁 trainer/
│           └── 📄 BulkImportUploader.tsx    # Upload component
└── 📁 public/
    └── 📄 bulk_import_template.xlsx         # Generated template
```

## 🎯 Access

**URL**: `https://your-app.com/trainer/bulk-import`

**Sidebar**: Trainer → "Bulk Import" (with Upload icon)

## 🔐 Security

- Only trainers can access bulk import
- Trainer ID required for upload
- All courses are linked to the uploading trainer
- Authentication verified via API

## 📞 Support

If you encounter issues:
1. Check error messages for specific row/column issues
2. Verify data types and required fields
3. Ensure course titles match exactly across sheets
4. Check console logs for detailed error information

---

**Last Updated**: November 27, 2025

---

## 📄 Use Case PDF Bulk Import

A separate script is available for importing Use Case PDF documents with role-based visibility (trainee vs trainer) and automatic HAI indexing.

### Overview

The `bulk-import-use-case-pdfs.ts` script:
- Scans a folder structure for PDF files
- Uploads to Supabase Storage
- Creates `contentDocuments` records with proper visibility
- Triggers HAI ingestion for TRAINER_SOLUTION documents (for RAG)

### Expected Folder Structure

```
use_cases_import/
├── K1_Use-Cases/          (Kapitel 1)
│   ├── 1a/                (Use Case identifier)
│   │   ├── Example_Use-Case_1a.pdf           → TRAINER_SOLUTION (full)
│   │   └── Example_Use-Case_1a_Fragen.pdf    → TRAINEE_QUESTION
│   └── 1b/
│       └── ...
├── K2_Use-Cases/
│   └── ...
└── ...
```

**Naming Convention:**
- `*_Fragen.pdf` → **TRAINEE_QUESTION** (visible to trainees)
- All other PDFs → **TRAINER_SOLUTION** (trainer only, indexed by HAI)

### Usage Commands

```bash
# Dry run (preview changes without modifying anything)
npm run import:use-cases:dry-run

# Full import with HAI indexing
npm run import:use-cases

# Quick import (skip HAI indexing - can index later)
npm run import:use-cases:quick
```

### Configuration

Edit `scripts/bulk-import-use-case-pdfs.ts` to customize:

```typescript
const CONFIG = {
    importFolder: './use_cases_import',     // Source folder
    componentFolderPattern: /^K(\d+)_Use-Cases$/i,  // K1, K2 pattern
    useCaseFolderPattern: /^(\d+)([a-z])$/i,        // 1a, 1b pattern
    questionSuffix: '_Fragen.pdf',          // Question PDF suffix
    storageBucket: 'content',               // Supabase bucket
    storagePrefix: 'use-cases',             // Storage path prefix
    enableHaiIngestion: true,               // Enable RAG indexing
};
```

### How It Works

1. **Folder Scanning**: Identifies PDFs by folder hierarchy (K1→1a→files)
2. **Use Case Matching**: Matches to existing `useCases` by chapter/orderIndex or creates new ones
3. **Storage Upload**: Uploads to Supabase Storage with deduplication
4. **Document Records**: Creates `contentDocuments` with:
   - `documentType`: TRAINEE_QUESTION or TRAINER_SOLUTION
   - `visibility`: ALL (questions) or TRAINER_ONLY (solutions)
5. **HAI Indexing**: For TRAINER_SOLUTION, extracts text page-by-page and creates embeddings

### Role-Based Visibility

| Document Type | Trainee Visible | Trainer Visible | HAI Indexed |
|--------------|-----------------|-----------------|-------------|
| TRAINEE_QUESTION | ✅ | ✅ | ❌ |
| TRAINER_SOLUTION | ❌ | ✅ | ✅ |

### Mapping to Courses

The script maps folders to courses by:
1. **K{n}** → `courses.chapter = n` (e.g., K1 → chapter 1)
2. Falls back to title matching: `%Kapitel {n}%`
3. Creates new use cases if not found

### Output Example

```
╔══════════════════════════════════════════════════════════════════╗
║       BULK USE CASE PDF IMPORTER                                 ║
╚══════════════════════════════════════════════════════════════════╝

📁 Scanning folder: D:\project\use_cases_import

  📂 K1_Use-Cases (Component: K1)
     └─ 1a: 2 PDF(s)
     └─ 1b: 2 PDF(s)

📊 Found 4 PDF files to import

📁 Processing K1/1a (2 files)
   📋 Use Case: Use Case 1a (uuid-123)
   📄 Example_Use-Case_1a.pdf (TRAINER_SOLUTION)
      ✅ Uploaded successfully
      🤖 HAI indexed: 15 chunks, 5 pages
   📄 Example_Use-Case_1a_Fragen.pdf (TRAINEE_QUESTION)
      ✅ Uploaded successfully

═══════════════════════════════════════════════════════════════════
IMPORT SUMMARY
═══════════════════════════════════════════════════════════════════
Total files scanned: 4
Successfully uploaded: 4
Failed: 0
HAI indexed: 2
═══════════════════════════════════════════════════════════════════
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "No course found for chapter N" | Create course with `chapter = N` or matching title |
| Storage upload failed | Check SUPABASE_SERVICE_ROLE_KEY |
| HAI ingestion failed | Verify GEMINI_API_KEY and hai_embeddings table exists |
| Missing trainer | Add TRAINER role user or set CONFIG.defaultTrainerId |
