# QA-Umgebung & Systemarchitektur: Handbuch

Dieses Dokument dient als zentrale Wissensquelle für die FIAE-Lernplattform. Es ist in zwei Teile gegliedert:
1.  **Management-Summary:** Eine verständliche Übersicht für Projektleiter und Stakeholder (ohne technischen Jargon).
2.  **Technisches Handbuch:** Detaillierte Anweisungen für Entwickler und Administratoren zur Wartung des Systems.

---

# TEIL 1: Management-Summary (Konzept)

## 1. Was ist die FIAE-Plattform?
Die FIAE-Plattform ("Wamocon Academy") ist das digitale Klassenzimmer für unsere angehenden Fachinformatiker. Stellen Sie es sich wie eine moderne Schule im Internet vor:
*   **Trainer** können Lehrmaterialien (Kurse, PDFs, Videos) erstellen und Prüfungen (Quizze) verteilen.
*   **Auszubildende** loggen sich ein, lernen interaktiv und sehen ihren Fortschritt in Echtzeit.

Das Ziel ist es, den Lernprozess transparent, digital und effizient zu gestalten.

## 2. Wie wir Qualität sichern (Die 3 Umgebungen)
Um sicherzustellen, dass die Plattform immer reibungslos funktioniert, arbeiten wir nicht direkt am "offenen Herzen". Wir nutzen ein **3-Stufen-Modell**, ähnlich wie in der Autoindustrie (Entwurf -> Crashtest -> Serie).

### 🟢 1. Development (Die Werkstatt)
Hier bauen unsere Programmierer neue Funktionen. Das passiert auf ihren eigenen Computern. Wenn hier etwas kaputt geht, merkt es niemand außer dem Programmierer selbst.

### 🟡 2. QA / Testing (Der Simulator)
*   **Was ist das?** Dies ist unsere "Teststrecke". Sie sieht exakt so aus wie die echte Plattform und enthält auch die gleichen Daten (kopiert aus der Realität), ist aber für normale Nutzer nicht zugänglich.
*   **Wozu dient sie?** Bevor wir ein neues Feature (z.B. "Neues Quiz-Modul") auf die echte Seite bringen, installieren wir es zuerst hier. Tester können wild herumklicken und versuchen, Fehler zu finden.
*   **Technik:** Diese Umgebung läuft in der Cloud (**Vercel**), damit sie von überall erreichbar ist.

### 🔴 3. Production (Die Live-Bühne)
*   **Was ist das?** Das ist die "echte" Seite, die Kunden und Azubis täglich nutzen.
*   **Sicherheit:** Diese Umgebung ist streng geschützt. Wir nutzen hierfür **Strato Docker Container**, um maximale Stabilität und Datensouveränität zu garantieren.
*   **Regel:** Es darf kein Code hier landen, der nicht vorher in der QA-Umgebung (Gelb) geprüft wurde.

## 3. Unser Technologie-Fundament
Wir nutzen modernste Bausteine für dieses Projekt:
*   **Next.js:** Der Motor der Website (schnell und SEO-freundlich).
*   **Supabase:** Unser digitaler Aktenschrank. Hier liegen alle Benutzerdaten und Dateien sicher verschlüsselt.
*   **Vercel & Docker:** Die Server, auf denen die Software läuft.

---

# TEIL 2: Technisches Handbuch (Für Entwickler)

Ab hier folgen technische Details für die IT-Abteilung zur Wartung und Einrichtung der Infrastruktur.

## 1. Tech Stack Details
*   **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn/UI Components.
*   **Backend:** Supabase (PostgreSQL, Auth, Storage).
*   **ORM:** Drizzle ORM (Schema-Migrationen & Typsicherheit).
*   **Infrastructure:**
    *   **QA:** Vercel (Serverless).
    *   **Prod:** Strato (Dockerized).

## 2. Die QA-Architektur
Die QA-Umgebung ist ein Spiegel ("Mirror") der Produktion. Um diesen Spiegel aktuell zu halten, nutzen wir automatisierte Skripte (`/scripts/*.ts` im Repo).

### Der Sync-Prozess (Production -> QA)
Um valide Tests durchzuführen, benötigen wir echte Daten. Der Sync-Prozess besteht aus drei Phasen:

1.  **Datenbank Re-Import:**
    *   Das Skript `complete-reimport.ts` löscht die QA-Datenbank.
    *   Es zieht Live-Daten aus PROD und importiert sie in QA.
    *   *Security Feature:* Alle Passwörter der importierten User werden auf `123123123` gesetzt, um Testern den Zugang zu erleichtern, ohne echte User-Passwörter zu kennen.

2.  **Asset Migration (Dateien):**
    *   Da die Datenbank nur Links enthält, müssen physische Dateien (PDFs) ebenfalls verschoben werden.
    *   `backup-supabase.ts`: Download von PROD.
    *   `restore-to-supabase.ts`: Upload in den QA-Bucket.

3.  **Connection Pooling (Wichtig für Vercel):**
    *   Da Vercel serverless läuft, nutzen wir den **Supabase Transaction Pooler** (Port 6543), um Connection-Limits zu vermeiden und IPv4-Kompatibilität zu sichern.

## 3. Setup-Guide: Neue Umgebung aufsetzen

### Schritt 1: Supabase vorbereiten
*   Projekt erstellen.
*   **Transaction Pooler** URL (Port 6543) notieren.

### Schritt 2: Schema & Daten
```bash
# 1. Schema übertragen
npx drizzle-kit push:pg

# 2. Daten klonen (Skripte nutzen .env Credentials)
npx tsx scripts/complete-reimport.ts
```

### Schritt 3: Storage Sync
```bash
npx tsx scripts/backup-supabase.ts
npx tsx scripts/restore-to-supabase.ts
```

### Schritt 4: Deployment Config
**Vercel (QA):**
*   Environment Variables setzen: `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY`.
*   **CRITICAL:** `DB_CONNECTION_STRING` muss auf den Pooler (Port 6543) zeigen.

**Strato (Production):**
*   Docker Image bauen: `docker build -t wamocon-app .`
*   Container mit Produktions-ENVs starten.

---
*Dokumentation erstellt am: 30.12.2025*
