# 📜 Arbeitszeugnis Module - Complete Implementation Plan

**Version:** 1.0
**Date:** 2026-02-06
**Deadline:** 13.02.2026 (MVP) | 04.03.2026 (Full Feature)
**Priority:** Low
**Developer:** Maanik Garg

---

## 🎯 Executive Summary

This module implements an **automated work certificate (Arbeitszeugnis) generation system** for trainees, based on:
- Weekly performance evaluations (trainee self-assessment + trainer rating)
- 19 MES Softskill criteria tracking
- Integration with existing Ausbildungsrahmenplan (ARP) themes
- Annual performance reviews with deviation analysis
- Automated PDF certificate generation with legal compliance (§16 BBiG)
- Warning system for trainees below 2.45 average (training shortening requirement)

---

## 📊 Module Architecture

### **Data Flow**
```
Weekly Activity Report
       ↓
Trainee Self-Assessment (1-6 scale)
       ↓
Trainer Assessment (1-6 scale)
       ↓
Weekly Evaluation Storage
       ↓
[52 weeks accumulated]
       ↓
Annual Performance Summary (4 competency areas)
       ↓
Annual Discussion & Documentation
       ↓
Work Certificate Generation (PDF)
```

---

## 🗄️ Database Schema

### **New Tables**

1. **`mes_softskill_criteria`** - Master data (19 criteria)
   - `K3.1-K3.6`: Anwenden (Apply) - 6 criteria
   - `K4.1-K4.7`: Analysieren (Analyze) - 7 criteria
   - `K5.1-K5.6`: Bewerten (Evaluate) - 6 criteria
   - Competency areas: FACHKOMPETENZ, METHODENKOMPETENZ, SOZIALKOMPETENZ, PERSONALKOMPETENZ

2. **`weekly_evaluations`** - Core weekly assessment data
   - Links to `activity_reports` (existing)
   - Links to `training_use_cases` (ARP themes)
   - Stores trainee self-rating + trainer rating (1-6)
   - Tracks submission workflow (DRAFT → SUBMITTED → APPROVED/REJECTED)

3. **`weekly_softskill_ratings`** - 19 criteria ratings per week
   - One row per criterion per week
   - Self + trainer rating for each skill

4. **`annual_performance_summaries`** - Yearly aggregations
   - Averages per competency area
   - Warning flags (< 2.45)
   - Annual discussion documentation

5. **`work_certificates`** - Generated certificates
   - Auto-generated text from templates
   - Mandatory trainer summary (2000 chars)
   - PDF storage + digital signatures
   - Lock mechanism (immutable once issued)

6. **`certificate_text_templates`** - Legal text modules
   - German standard phrasing per grade (1-6)
   - Per competency area
   - Editable by authorized users

### **Existing Tables (Integration Points)**

- `activity_reports` - Link to weekly evaluations
- `training_use_cases` - ARP themes for weekly topics
- `profiles` - Trainee and trainer references

---

## 🚀 Implementation Phases

### **Phase 1: Weekly Evaluation MVP** (Target: 13.02.2026)

**Goal:** Basic weekly evaluation integrated with activity reports

#### **1.1 Backend API Routes**

**Trainee Routes:**
- `POST /api/trainee/evaluations/weekly` - Submit self-assessment
- `GET /api/trainee/evaluations/weekly?week=X&year=Y` - Get evaluation for week
- `GET /api/trainee/evaluations/history?year=Y` - Get all evaluations for year
- `GET /api/trainee/evaluations/softskills` - Get MES criteria list

**Trainer Routes:**
- `GET /api/trainer/evaluations/pending` - Get pending evaluations
- `PUT /api/trainer/evaluations/[id]` - Submit trainer assessment
- `POST /api/trainer/evaluations/[id]/approve` - Approve evaluation
- `POST /api/trainer/evaluations/[id]/reject` - Reject & request correction
- `GET /api/trainer/evaluations/trainee/[traineeId]?year=Y` - Get trainee's evaluations

**Shared Routes:**
- `GET /api/softskills` - Get MES criteria master data
- `GET /api/arp-themes` - Get ARP use cases (training_use_cases)

#### **1.2 UI Components**

**Trainee Side:**
1. **`WeeklyEvaluationForm.tsx`**
   - Dropdown: Select ARP theme (from training_use_cases)
   - Self-rating selector (1-6) with German grade labels
   - Softskill ratings (19 criteria, collapsible accordion)
   - Comment field (max 500 chars)
   - Submit button → Changes activity report status

2. **`EvaluationHistoryTable.tsx`**
   - Table: Week | Theme | Self-Rating | Trainer-Rating | Deviation | Status
   - Color coding: Green (< 1 grade diff), Yellow (1-2), Red (> 2)
   - Filter by year/month

**Trainer Side:**
1. **`PendingEvaluationsQueue.tsx`**
   - List of submitted evaluations awaiting review
   - Quick view of trainee's self-assessment
   - Notification badge count

2. **`TrainerEvaluationReview.tsx`**
   - Display trainee self-assessment (read-only)
   - Trainer rating inputs (1-6) for overall + 19 softskills
   - Side-by-side comparison view
   - Comment field
   - Approve / Request Correction buttons

#### **1.3 Integration with Activity Reports**

**Modify existing `activity_reports` workflow:**
- Add "Leistungsbewertung" section to weekly report
- When trainee submits activity report → also create `weekly_evaluations` entry
- When trainer approves activity report → prompt for evaluation
- Link evaluation status in activity reports list

#### **1.4 Database Migration**

```bash
# Create migration
npx drizzle-kit generate:pg

# Apply migration
npx drizzle-kit push:pg

# Seed MES criteria data
npx tsx scripts/seed-mes-criteria.ts
```

---

### **Phase 2: Annual Overview & Discussion** (Target: 20.02.2026)

**Goal:** Annual aggregation and trainer-trainee discussion documentation

#### **2.1 Backend API Routes**

**Trainer Routes:**
- `GET /api/trainer/evaluations/annual/[traineeId]?year=Y` - Generate annual summary
- `POST /api/trainer/evaluations/annual/[traineeId]/finalize` - Finalize annual performance
- `PUT /api/trainer/evaluations/annual/[id]/discussion` - Document annual discussion

**Trainee Routes:**
- `GET /api/trainee/evaluations/annual?year=Y` - View own annual summary
- `POST /api/trainee/evaluations/annual/[id]/statement` - Add trainee statement

#### **2.2 Calculation Logic**

**Automatic Calculation Service:**
```typescript
// src/lib/arbeitszeugnis/calculateAnnualPerformance.ts
function calculateAnnualPerformance(traineeId, year, ausbildungsjahr) {
  // 1. Fetch all weekly_evaluations for trainee+year
  // 2. Group softskill ratings by competency_area
  // 3. Calculate averages:
  //    - FACHKOMPETENZ: avg of K3.6, K5.4, technical theme ratings
  //    - METHODENKOMPETENZ: avg of K3.3, K4.1, K4.2, K4.4, K5.1
  //    - SOZIALKOMPETENZ: avg of K3.1, K3.2, K4.6, K5.2, K5.6
  //    - PERSONALKOMPETENZ: avg of K3.4, K3.5, K4.3, K4.5, K4.7, K5.3, K5.5
  // 4. Calculate overall average
  // 5. Set warning flag if overall < 2.45
  // 6. Store in annual_performance_summaries
}
```

#### **2.3 UI Components**

**Trainer Side:**
1. **`AnnualPerformanceOverview.tsx`**
   - Yearly calendar grid (52 weeks)
   - Heatmap visualization (green/yellow/red deviations)
   - Competency area cards with averages
   - Generate overview button

2. **`AnnualDiscussionForm.tsx`**
   - Pre-populated performance data
   - Deviation highlights (self vs trainer)
   - Discussion summary editor (rich text)
   - Trainee statement section
   - Finalize button

**Trainee Side:**
1. **`MyAnnualPerformance.tsx`**
   - Read-only view of aggregated performance
   - Deviation analysis charts
   - Space for trainee statement
   - Discussion appointment scheduling

---

### **Phase 3: Certificate Generator** (Target: 28.02.2026)

**Goal:** Automated PDF work certificate generation

#### **3.1 Backend API Routes**

**Trainer Routes:**
- `POST /api/trainer/certificates` - Create new certificate
- `GET /api/trainer/certificates/[id]/preview` - Preview certificate text
- `POST /api/trainer/certificates/[id]/generate-pdf` - Generate PDF
- `POST /api/trainer/certificates/[id]/approve` - Approve & lock certificate
- `GET /api/trainer/certificates/templates` - Get/edit text templates

**Trainee Routes:**
- `GET /api/trainee/certificates` - List own certificates
- `GET /api/trainee/certificates/[id]` - View certificate details
- `GET /api/trainee/certificates/[id]/download` - Download PDF

#### **3.2 PDF Generation**

**Library:** `@react-pdf/renderer` (already in use for activity reports)

**Template Structure:**
```typescript
// src/lib/arbeitszeugnis/certificatePdfGenerator.ts
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

function generateCertificatePDF(certificate, traineeProfile, trainerProfile) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* 1. Company Header */}
        <View style={styles.header}>
          <Text>WAMOCON GmbH</Text>
          <Text>Arbeitszeugnis</Text>
        </View>

        {/* 2. Personal Data */}
        <View style={styles.personalData}>
          <Text>Herr/Frau {traineeProfile.fullName}</Text>
          <Text>geboren am {traineeProfile.birthDate}</Text>
          <Text>Ausbildung: {certificate.periodStart} - {certificate.periodEnd}</Text>
        </View>

        {/* 3. Introduction (legal standard) */}
        <Text style={styles.intro}>
          Herr/Frau {traineeProfile.fullName} war vom {certificate.periodStart} bis
          {certificate.periodEnd} als Auszubildende/r zum/zur Fachinformatiker/in
          für Anwendungsentwicklung in unserem Unternehmen tätig.
        </Text>

        {/* 4. Competency Assessments (from templates) */}
        {certificate.competencyAreas.map(area => (
          <View key={area.type}>
            <Text style={styles.competencyTitle}>{area.label}</Text>
            <Text>{getTemplateText(area.type, area.grade)}</Text>
          </View>
        ))}

        {/* 5. Custom Summary (MANDATORY - trainer input) */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Zusammenfassung</Text>
          <Text>{certificate.customSummary}</Text>
        </View>

        {/* 6. Closing Phrase (legal requirement) */}
        <Text style={styles.closing}>
          Wir bedanken uns für die stets gute Zusammenarbeit und wünschen
          Herrn/Frau {traineeProfile.fullName} für die Zukunft alles Gute.
        </Text>

        {/* 7. Signatures */}
        <View style={styles.signatures}>
          <Text>Ort, Datum</Text>
          <Text>__________________</Text>
          <Text>{trainerProfile.fullName}</Text>
          <Text>Ausbilder/in</Text>
        </View>
      </Page>
    </Document>
  );
}
```

#### **3.3 UI Components**

**Trainer Side:**
1. **`CertificateGenerator.tsx`**
   - Input: Select trainee + year
   - Auto-load annual performance data
   - Preview generated text
   - Mandatory summary field (2000 chars) - **PFLICHTFELD**
   - Edit competency grades if needed
   - Generate PDF button
   - Download & approve workflow

2. **`CertificateTemplateEditor.tsx`**
   - Edit standard text modules per grade
   - Save custom templates
   - Reset to system defaults

**Trainee Side:**
1. **`MyCertificates.tsx`**
   - List of issued certificates
   - Download PDF button
   - View details (read-only)

---

### **Phase 4: Warning System & Analytics** (Target: 04.03.2026)

**Goal:** Proactive alerts and performance insights

#### **4.1 Warning System**

**Triggers:**
1. **Weekly Warning:**
   - If trainee's weekly avg < 2.45 for 3 consecutive weeks
   - Notification to trainee + assigned trainer

2. **Monthly Warning:**
   - If monthly average < 2.45
   - Email + dashboard notification

3. **Annual Warning:**
   - If annual average < 2.45
   - Flag in annual summary
   - Alert that training shortening is at risk

**Implementation:**
```typescript
// src/lib/arbeitszeugnis/warningSystem.ts
async function checkPerformanceWarnings(traineeId) {
  const recent = await getRecentEvaluations(traineeId, weeks: 3);
  const avg = calculateAverage(recent);

  if (avg < 2.45) {
    await createNotification({
      userId: traineeId,
      type: 'PERFORMANCE_WARNING',
      title: 'Leistungswarnung',
      message: `Dein Notendurchschnitt (${avg.toFixed(2)}) liegt unter dem Verkürzungsgrenzwert von 2.45.`,
      linkUrl: '/trainee/evaluations/performance',
    });

    // Notify assigned trainer
    await createNotification({
      userId: trainee.assignedTrainerId,
      type: 'TRAINEE_PERFORMANCE_ALERT',
      title: `Leistungswarnung: ${trainee.fullName}`,
      message: `Durchschnitt: ${avg.toFixed(2)} (unter 2.45)`,
      linkUrl: `/trainer/trainees/${traineeId}/evaluations`,
    });
  }
}
```

#### **4.2 Analytics Dashboard**

**Trainer Analytics:**
- Performance trends over time (line chart)
- Competency area radar chart
- Trainee comparison (anonymized)
- Deviation analysis (self vs trainer)
- Warning flag overview

**Trainee Analytics:**
- Personal performance timeline
- Competency area strengths/weaknesses
- Self-assessment accuracy
- Goal progress tracking

---

## 🔧 Technical Implementation Details

### **Directory Structure**

```
src/
├── app/
│   ├── api/
│   │   ├── trainee/
│   │   │   └── evaluations/
│   │   │       ├── weekly/route.ts
│   │   │       ├── history/route.ts
│   │   │       ├── annual/route.ts
│   │   │       └── softskills/route.ts
│   │   ├── trainer/
│   │   │   ├── evaluations/
│   │   │   │   ├── pending/route.ts
│   │   │   │   ├── [id]/route.ts
│   │   │   │   ├── [id]/approve/route.ts
│   │   │   │   └── annual/[traineeId]/route.ts
│   │   │   └── certificates/
│   │   │       ├── route.ts
│   │   │       ├── [id]/route.ts
│   │   │       └── [id]/generate-pdf/route.ts
│   │   └── softskills/route.ts (shared)
│   ├── trainee/
│   │   ├── evaluations/
│   │   │   ├── page.tsx (weekly evaluations)
│   │   │   ├── history/page.tsx
│   │   │   └── performance/page.tsx (analytics)
│   │   └── certificates/
│   │       └── page.tsx
│   └── trainer/
│       ├── evaluations/
│       │   ├── page.tsx (pending queue)
│       │   ├── [id]/page.tsx (review)
│       │   └── annual/[traineeId]/page.tsx
│       └── certificates/
│           ├── page.tsx (list & generator)
│           ├── [id]/page.tsx (edit)
│           └── templates/page.tsx
├── components/
│   └── arbeitszeugnis/
│       ├── WeeklyEvaluationForm.tsx
│       ├── SoftskillRatingGrid.tsx
│       ├── EvaluationHistoryTable.tsx
│       ├── TrainerEvaluationReview.tsx
│       ├── AnnualPerformanceOverview.tsx
│       ├── AnnualDiscussionForm.tsx
│       ├── CertificateGenerator.tsx
│       ├── CertificatePDFPreview.tsx
│       ├── CertificateTemplateEditor.tsx
│       └── PerformanceWarningBadge.tsx
├── lib/
│   └── arbeitszeugnis/
│       ├── calculateAnnualPerformance.ts
│       ├── certificatePdfGenerator.ts
│       ├── certificateTextGenerator.ts
│       ├── warningSystem.ts
│       └── types.ts
└── db/
    └── migrations/
        └── drizzle/
            └── arbeitszeugnis_schema.sql
```

### **Type Definitions**

```typescript
// src/lib/arbeitszeugnis/types.ts

export type PerformanceRating = '1' | '2' | '3' | '4' | '5' | '6';

export type CompetencyArea =
  | 'FACHKOMPETENZ'
  | 'METHODENKOMPETENZ'
  | 'SOZIALKOMPETENZ'
  | 'PERSONALKOMPETENZ';

export interface WeeklyEvaluation {
  id: string;
  traineeId: string;
  trainerId: string;
  activityReportId?: string;
  weekNumber: number;
  year: number;
  ausbildungsjahr: number;
  arpUseCaseId?: string;
  arpThemeText?: string;
  selfRating?: PerformanceRating;
  selfComment?: string;
  selfSubmittedAt?: Date;
  trainerRating: PerformanceRating;
  trainerComment?: string;
  trainerApprovedAt?: Date;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  softskillRatings?: SoftskillRating[];
}

export interface SoftskillRating {
  id: string;
  criterionId: string;
  criterionName: string;
  selfRating?: PerformanceRating;
  trainerRating: PerformanceRating;
  trainerComment?: string;
}

export interface AnnualPerformanceSummary {
  id: string;
  traineeId: string;
  ausbildungsjahr: number;
  year: number;
  fachkompetenzAvg: number;
  methodenkompetenzAvg: number;
  sozialkompetenzAvg: number;
  personalkompetenzAvg: number;
  overallAverage: number;
  totalWeeksEvaluated: number;
  evaluationCompletionRate: number;
  belowCutoffWarning: boolean;
  discussionDate?: Date;
  discussionSummary?: string;
  traineeStatement?: string;
  isFinalized: boolean;
}

export interface WorkCertificate {
  id: string;
  traineeId: string;
  annualSummaryId?: string;
  certificateType: 'INTERIM' | 'FINAL';
  issueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  ausbildungsjahr: number;
  generatedText: string;
  customSummary: string; // MANDATORY
  fachkompetenzGrade: PerformanceRating;
  methodenkompetenzGrade: PerformanceRating;
  sozialkompetenzGrade: PerformanceRating;
  personalkompetenzGrade: PerformanceRating;
  pdfUrl?: string;
  pdfGeneratedAt?: Date;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'ISSUED';
  approvedByTrainerId?: string;
  approvedAt?: Date;
  traineeSignedAt?: Date;
  trainerSignedAt?: Date;
  isLocked: boolean;
}
```

---

## 🔗 Integration Points

### **1. Sidebar Navigation**

Add to `src/components/layout/Sidebar.tsx`:

```typescript
// For trainee
{
  id: 'evaluations',
  label: t('nav.evaluations'),
  icon: ClipboardCheck, // from lucide-react
  href: '/trainee/evaluations',
},
{
  id: 'certificates',
  label: t('nav.certificates'),
  icon: Award, // from lucide-react
  href: '/trainee/certificates',
}

// For trainer
{
  id: 'evaluations',
  label: t('nav.evaluations'),
  icon: ClipboardCheck,
  href: '/trainer/evaluations',
},
{
  id: 'certificates',
  label: t('nav.certificates'),
  icon: Award,
  href: '/trainer/certificates',
}
```

### **2. Dashboard Widgets**

**Trainee Dashboard:**
- Performance summary card (current average)
- Pending evaluation reminder
- Warning badge if below 2.45

**Trainer Dashboard:**
- Pending evaluations count
- Upcoming annual discussions list
- Performance warnings (trainees at risk)

### **3. Activity Reports Integration**

Modify `src/app/api/trainee/school/reports/[id]/submit/route.ts`:
- After trainee submits activity report → create `weekly_evaluations` entry (status: DRAFT)
- Prompt trainee to complete self-assessment

Modify `src/app/api/trainer/activity-reports/[id]/route.ts`:
- After trainer approves activity report → redirect to evaluation review
- Link evaluation status in reports table

### **4. Notifications**

Use existing `notifications` table to send:
- "Bitte deine Wochenleistung bewerten" (Trainee reminder on Fridays)
- "Neue Bewertung wartet auf Freigabe" (Trainer notification)
- "Leistungswarnung: Durchschnitt unter 2.45" (Warning alerts)
- "Jahresgespräch vereinbaren" (Annual discussion reminder)

---

## 📱 UI/UX Considerations

### **Design Principles**

1. **Simplicity:** 1-click self-assessment on Fridays
2. **Transparency:** Always show self vs trainer comparison
3. **Gamification:** Visual progress (green/yellow/red color coding)
4. **Legal Compliance:** Clear § references, immutable PDFs
5. **Mobile-Friendly:** Responsive design for mobile self-assessment

### **Color Coding Standard**

- **Green:** Rating difference < 1.0 (close agreement)
- **Yellow:** Rating difference 1.0-1.9 (moderate deviation)
- **Red:** Rating difference >= 2.0 (significant deviation)
- **Blue:** Overall average >= 1.0 and <= 2.45 (shortening eligible)
- **Orange:** Overall average > 2.45 and < 4.0 (standard range)
- **Red:** Overall average >= 4.0 (warning range)

### **Accessibility**

- ARIA labels for all form inputs
- Keyboard navigation support
- Screen reader friendly
- High contrast mode support

---

## 🧪 Testing Strategy

### **Unit Tests**

```typescript
// tests/unit/lib/arbeitszeugnis/calculateAnnualPerformance.test.ts
describe('calculateAnnualPerformance', () => {
  it('should correctly average 52 weeks of ratings', () => {});
  it('should set warning flag when average < 2.45', () => {});
  it('should handle missing weeks gracefully', () => {});
  it('should correctly map softskills to competency areas', () => {});
});
```

### **Integration Tests**

```typescript
// tests/integration/api/trainer/evaluations.test.ts
describe('POST /api/trainer/evaluations/[id]', () => {
  it('should save trainer assessment', () => {});
  it('should send notification to trainee on approval', () => {});
  it('should reject invalid ratings', () => {});
});
```

### **E2E Tests (Playwright)**

```typescript
// tests/e2e/arbeitszeugnis.spec.ts
test('trainee can submit self-assessment', async ({ page }) => {
  // Navigate to evaluations
  // Fill form
  // Submit
  // Verify success message
});

test('trainer can approve evaluation', async ({ page }) => {
  // Navigate to pending queue
  // Select evaluation
  // Enter ratings
  // Approve
  // Verify notification sent
});
```

---

## 📈 Performance Considerations

### **Database Indexing**

✅ Already defined in schema:
- `idx_weekly_evals_trainee` on `trainee_id`
- `idx_weekly_evals_year` on `year, ausbildungsjahr`
- `idx_annual_summaries_warning` on `below_cutoff_warning`

### **Caching Strategy**

- **Annual summaries:** Cache for 24 hours (recalculate nightly)
- **MES criteria:** Static, cache indefinitely
- **Certificate templates:** Cache until edited

### **Batch Processing**

- **Nightly job:** Calculate annual summaries for all trainees
- **Weekly job:** Send evaluation reminders every Friday
- **Monthly job:** Generate performance reports

---

## 🔒 Security & Permissions

### **Role-Based Access Control (RBAC)**

| Feature | Trainee | Trainer | Admin |
|---------|---------|---------|-------|
| Submit self-assessment | ✅ Own only | ❌ | ❌ |
| View own evaluations | ✅ Own only | ❌ | ✅ All |
| Submit trainer assessment | ❌ | ✅ Assigned only | ✅ All |
| View annual summary | ✅ Own only | ✅ Assigned only | ✅ All |
| Generate certificate | ❌ | ✅ Assigned only | ✅ All |
| Edit templates | ❌ | ❌ | ✅ |
| Download own certificate | ✅ Own only | ❌ | ✅ All |

### **Data Validation**

- **Rating range:** Must be 1-6 (enum validation)
- **Comment length:** Max 500 chars (weekly), 2000 chars (summary)
- **Workflow enforcement:** Cannot skip statuses (DRAFT → SUBMITTED → APPROVED)
- **Immutability:** Locked certificates cannot be edited

### **Audit Trail**

- Log all rating submissions (timestamp + user)
- Track certificate approvals
- Record annual discussion dates
- Store rejection reasons

---

## 🌐 Internationalization (i18n)

### **Translation Keys**

Add to `src/contexts/LanguageContext.tsx`:

```typescript
evaluations: {
  title: {
    de: 'Leistungsbewertungen',
    en: 'Performance Evaluations'
  },
  weekly: {
    de: 'Wöchentliche Bewertung',
    en: 'Weekly Evaluation'
  },
  selfAssessment: {
    de: 'Selbsteinschätzung',
    en: 'Self-Assessment'
  },
  trainerRating: {
    de: 'Ausbilder-Bewertung',
    en: 'Trainer Rating'
  },
  competencyAreas: {
    fachkompetenz: {
      de: 'Fachkompetenz',
      en: 'Technical Competency'
    },
    methodenkompetenz: {
      de: 'Methodenkompetenz',
      en: 'Methodological Competency'
    },
    sozialkompetenz: {
      de: 'Sozialkompetenz',
      en: 'Social Competency'
    },
    personalkompetenz: {
      de: 'Personalkompetenz',
      en: 'Personal Competency'
    }
  },
  grades: {
    '1': { de: 'Sehr gut', en: 'Excellent' },
    '2': { de: 'Gut', en: 'Good' },
    '3': { de: 'Befriedigend', en: 'Satisfactory' },
    '4': { de: 'Ausreichend', en: 'Sufficient' },
    '5': { de: 'Mangelhaft', en: 'Deficient' },
    '6': { de: 'Ungenügend', en: 'Insufficient' }
  },
  warnings: {
    belowCutoff: {
      de: 'Durchschnitt unter 2.45 - Verkürzung gefährdet!',
      en: 'Average below 2.45 - Training shortening at risk!'
    }
  }
}
```

---

## 📝 Documentation Requirements

### **User Documentation**

1. **Trainee Guide:**
   - "Wie bewerte ich meine Wochenleistung?"
   - "Was bedeuten die Noten?"
   - "Wie sehe ich meine Jahresübersicht?"

2. **Trainer Guide:**
   - "Leistungsbewertungen freigeben"
   - "Jahresgespräch dokumentieren"
   - "Arbeitszeugnisse erstellen"

### **Technical Documentation**

- API documentation (OpenAPI/Swagger)
- Database schema documentation (ERD diagram)
- Calculation logic documentation

---

## 🚨 Risk Mitigation

### **Identified Risks**

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Trainer forgets weekly evaluations | High | Medium | Automated Friday reminders + dashboard badge |
| Database performance (52 weeks × N trainees) | Medium | Low | Proper indexing + pagination |
| Legal non-compliance in certificate text | High | Low | Legal review of templates + immutability |
| User confusion (complex UI) | Medium | Medium | Gradual rollout + training + tooltips |
| PDF generation errors | Medium | Low | Error handling + fallback plain text |

---

## 📅 Timeline & Milestones

| Milestone | Target Date | Status | Deliverables |
|-----------|-------------|--------|--------------|
| **Phase 1: MVP** | 13.02.2026 | 🟡 Planned | Weekly evaluations, softskill ratings, basic UI |
| **Phase 2: Annual Review** | 20.02.2026 | 🟡 Planned | Annual summaries, discussion docs, averages |
| **Phase 3: Certificates** | 28.02.2026 | 🟡 Planned | PDF generation, templates, approval workflow |
| **Phase 4: Analytics** | 04.03.2026 | 🟡 Planned | Warnings, dashboards, insights |
| **IHK Demo** | 04.03.2026 | 🟡 Planned | Demo-ready with 2-3 trainee samples |

---

## 🎓 Demo Preparation (IHK Presentation)

### **Demo Scenario**

1. **Show weekly evaluation:**
   - Trainee completes self-assessment (2 mins)
   - Trainer reviews and approves (1 min)

2. **Show annual overview:**
   - 52-week heatmap visualization
   - Competency area breakdown
   - Warning flags demonstration

3. **Generate certificate:**
   - Select trainee
   - Preview auto-generated text
   - Add custom summary
   - Generate PDF
   - Download and display

### **Sample Data**

Create 3 demo trainees:
- **Trainee A:** Excellent (avg 1.5) - no warnings
- **Trainee B:** Good (avg 2.8) - just below cutoff, shows warning
- **Trainee C:** Struggling (avg 4.2) - multiple warnings, needs support

---

## ✅ Pre-Launch Checklist

### **Before Phase 1 Release**

- [ ] Database migration applied successfully
- [ ] MES criteria seeded (19 entries)
- [ ] API routes tested (Postman/Thunder Client)
- [ ] UI components responsive on mobile
- [ ] Notifications working (email + in-app)
- [ ] German translations complete
- [ ] Activity reports integration tested
- [ ] Error handling implemented
- [ ] Loading states added
- [ ] Trainer + trainee user tested

### **Before IHK Demo**

- [ ] Demo data seeded (3 trainees, 52 weeks each)
- [ ] PDF generation tested on production
- [ ] Performance tested (100+ evaluations load time < 2s)
- [ ] Legal review of certificate templates completed
- [ ] Screenshots prepared for documentation
- [ ] Backup plan if live demo fails (pre-recorded video)

---

## 🛠️ Supabase MCP Configuration

### **Where to configure Supabase MCP access:**

Claude Code MCP servers are typically configured in:

**Option 1: Global MCP Settings**
Create/edit: `~/.claude/mcp_settings.json` (on Windows: `C:\Users\<YourName>\.claude\mcp_settings.json`)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key-here"
      }
    }
  }
}
```

**Option 2: Project-Specific Settings**
Add to: `.claude/settings.local.json` (already exists in your project)

```json
{
  "permissions": {
    // ... existing permissions ...
  },
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server"],
      "env": {
        "SUPABASE_URL": "https://yxzaflchsqbzhomfwyjh.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

**How to get your Supabase credentials:**
1. Go to Supabase Dashboard → Settings → API
2. Copy **Project URL** → `SUPABASE_URL`
3. Copy **service_role (secret)** key → `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **IMPORTANT:** Never commit `service_role` key to git! Add `.claude/settings.local.json` to `.gitignore` if not already done.

---

## 📞 Support & Questions

**Developer:** Maanik Garg (maanik.garg@wamocon.com)
**Reviewer:** Waleri Moretz (waleri.moretz@wamocon.com)
**Deadline:** 13.02.2026 (MVP) | 04.03.2026 (Full)

---

## 🏁 Next Steps

1. **Review this implementation plan** with Waleri Moretz
2. **Set up Supabase MCP** (configure access token as shown above)
3. **Run database migration** (`arbeitszeugnis_schema.sql`)
4. **Start Phase 1 implementation** (weekly evaluations)
5. **Weekly sync meetings** to track progress

---

**Version:** 1.0
**Last Updated:** 2026-02-06
**Status:** Ready for Implementation 🚀
