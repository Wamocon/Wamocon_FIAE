'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Upload, Download, FileSpreadsheet, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ImportStats {
  coursesCreated: number;
  enablersCreated: number;
  useCasesCreated: number;
  skillsCreated: number;
  errors: string[];
}

interface ImportResult {
  success: boolean;
  message: string;
  stats: ImportStats;
}

export function BulkImportUploader() {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
        alert('Bitte wählen Sie eine Excel-Datei (.xlsx oder .xls)');
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !profile?.id) {
      alert('Bitte wählen Sie eine Datei aus');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('trainerId', profile.id);

      const response = await fetch('/api/trainer/bulk-import', {
        method: 'POST',
        body: formData,
      });

      const data: ImportResult = await response.json();
      setResult(data);

      if (data.success) {
        // Clear file input after successful upload
        setFile(null);
      }
    } catch (error: any) {
      setResult({
        success: false,
        message: 'Upload fehlgeschlagen',
        stats: {
          coursesCreated: 0,
          enablersCreated: 0,
          useCasesCreated: 0,
          skillsCreated: 0,
          errors: [error.message || 'Unbekannter Fehler'],
        },
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => { 
    // Download the template file
    window.open('/bulk_import_template.xlsx', '_blank');
  };

  return (
    <div className="bg-card border-border rounded-3xl border p-8 shadow-lg">
      <div className="mb-6">
        <h2 className="text-foreground mb-2 text-2xl font-bold">
          📊 Bulk Import
        </h2>
        <p className="text-muted-foreground">
          Importieren Sie mehrere Kurse, Enabler und Use Cases gleichzeitig aus einer Excel-Datei
        </p>
      </div>

      {/* Download Template Button */}
      <div className="bg-accent/10 mb-6 rounded-xl border border-accent/20 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="text-accent h-8 w-8" />
            <div>
              <h3 className="text-foreground font-semibold">Excel-Vorlage herunterladen</h3>
              <p className="text-muted-foreground text-sm">
                Laden Sie die Vorlage herunter und füllen Sie sie mit Ihren Daten
              </p>
            </div>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-6 py-3 transition-colors"
          >
            <Download className="h-5 w-5" />
            <span>Vorlage herunterladen</span>
          </button>
        </div>
      </div>

      {/* File Upload Section */}
      <div className="mb-6">
        <label className="text-muted-foreground mb-2 block text-sm font-medium">
          Excel-Datei auswählen
        </label>
        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="bg-muted border-border text-foreground focus:ring-accent flex-1 rounded-xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
          />
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground flex items-center gap-2 rounded-xl px-6 py-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <>
                <div className="border-primary-foreground h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"></div>
                <span>Wird hochgeladen...</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span>Hochladen</span>
              </>
            )}
          </button>
        </div>
        {file && (
          <p className="text-muted-foreground mt-2 text-sm">
            Ausgewählte Datei: <span className="text-foreground font-medium">{file.name}</span>
          </p>
        )}
      </div>

      {/* Results Section */}
      {result && (
        <div className={`rounded-xl border p-6 ${
          result.success 
            ? 'border-green-500/40 bg-green-500/10' 
            : 'border-yellow-500/40 bg-yellow-500/10'
        }`}>
          <div className="mb-4 flex items-center gap-3">
            {result.success ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <AlertCircle className="h-6 w-6 text-yellow-500" />
            )}
            <h3 className={`text-lg font-semibold ${
              result.success ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {result.message}
            </h3>
          </div>

          {/* Statistics */}
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">Kurse erstellt</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.coursesCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">Enabler erstellt</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.enablersCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">Use Cases erstellt</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.useCasesCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">Skills erstellt</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.skillsCreated}</p>
            </div>
          </div>

          {/* Errors */}
          {result.stats.errors.length > 0 && (
            <div className="bg-background/50 rounded-lg p-4">
              <div className="mb-2 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <h4 className="text-foreground font-semibold">
                  Fehler ({result.stats.errors.length})
                </h4>
              </div>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {result.stats.errors.map((error, index) => (
                  <div key={index} className="text-muted-foreground text-sm">
                    • {error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="bg-muted/50 mt-6 rounded-xl p-4">
        <h4 className="text-foreground mb-2 font-semibold">📝 Anweisungen:</h4>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>Laden Sie die Excel-Vorlage herunter</li>
          <li>Füllen Sie die Daten in den entsprechenden Sheets aus (Courses, Enablers, Use Cases)</li>
          <li>Löschen Sie die Instruktionszeilen (Zeilen 1-9) vor dem Import</li>
          <li>Speichern Sie die Datei und laden Sie sie hier hoch</li>
          <li>Überprüfen Sie die Ergebnisse und beheben Sie ggf. Fehler</li>
        </ol>
      </div>
    </div>
  );
}
