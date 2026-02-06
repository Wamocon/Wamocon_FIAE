'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
        alert(t('bulk.selectExcelFile'));
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !profile?.id) {
      alert(t('bulk.selectFile'));
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
        message: t('bulk.uploadFailed'),
        stats: {
          coursesCreated: 0,
          enablersCreated: 0,
          useCasesCreated: 0,
          skillsCreated: 0,
          errors: [error.message || t('bulk.unknownError')],
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
          {t('bulk.title')}
        </h2>
        <p className="text-muted-foreground">
          {t('bulk.description')}
        </p>
      </div>

      {/* Download Template Button */}
      <div className="bg-accent/10 mb-6 rounded-xl border border-accent/20 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="text-accent h-8 w-8" />
            <div>
              <h3 className="text-foreground font-semibold">{t('bulk.downloadTemplate')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('bulk.downloadTemplateDesc')}
              </p>
            </div>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-6 py-3 transition-colors"
          >
            <Download className="h-5 w-5" />
            <span>{t('bulk.templateDownload')}</span>
          </button>
        </div>
      </div>

      {/* File Upload Section */}
      <div className="mb-6">
        <label className="text-muted-foreground mb-2 block text-sm font-medium">
          {t('bulk.selectFileLabel')}
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
                <span>{t('bulk.uploading')}</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span>{t('bulk.upload')}</span>
              </>
            )}
          </button>
        </div>
        {file && (
          <p className="text-muted-foreground mt-2 text-sm">
            {t('bulk.selectedFile')} <span className="text-foreground font-medium">{file.name}</span>
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
              <p className="text-muted-foreground text-sm">{t('bulk.coursesCreated')}</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.coursesCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">{t('bulk.enablersCreated')}</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.enablersCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">{t('bulk.useCasesCreated')}</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.useCasesCreated}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-sm">{t('bulk.skillsCreated')}</p>
              <p className="text-foreground text-2xl font-bold">{result.stats.skillsCreated}</p>
            </div>
          </div>

          {/* Errors */}
          {result.stats.errors.length > 0 && (
            <div className="bg-background/50 rounded-lg p-4">
              <div className="mb-2 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <h4 className="text-foreground font-semibold">
                  {t('bulk.errors')} ({result.stats.errors.length})
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
        <h4 className="text-foreground mb-2 font-semibold">{t('bulk.instructions')}</h4>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>{t('bulk.instruction1')}</li>
          <li>{t('bulk.instruction2')}</li>
          <li>{t('bulk.instruction3')}</li>
          <li>{t('bulk.instruction4')}</li>
          <li>{t('bulk.instruction5')}</li>
        </ol>
      </div>
    </div>
  );
}
