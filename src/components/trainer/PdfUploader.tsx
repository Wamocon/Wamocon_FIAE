'use client';

import { useState, useRef } from 'react';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FILE_UPLOAD } from '@/lib/constants';

interface PdfUploaderProps {
    /** Current PDF URL (if any) */
    value?: string | null;
    /** Callback when PDF is uploaded */
    onUpload: (url: string) => void;
    /** Callback when PDF is removed */
    onRemove?: () => void;
    /** User ID for path generation */
    userId: string;
    /** Disabled state */
    disabled?: boolean;
}

const BUCKET_NAME = 'content';
const MAX_SIZE = FILE_UPLOAD.maxSize; // 10MB

export function PdfUploader({
    value,
    onUpload,
    onRemove,
    userId,
    disabled = false,
}: PdfUploaderProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (file: File) => {
        setError(null);

        // Validate file type
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Nur PDF-Dateien sind erlaubt');
            return;
        }

        // Validate file size
        if (file.size > MAX_SIZE) {
            setError(`Datei zu groß. Maximum: ${MAX_SIZE / 1024 / 1024}MB`);
            return;
        }

        try {
            setIsUploading(true);

            // Generate unique path
            const timestamp = Date.now();
            const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `${userId}/${timestamp}_${safeName}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: 'application/pdf',
                });

            if (uploadError) {
                // Check if bucket doesn't exist
                if (uploadError.message.includes('not found') || uploadError.message.includes('Bucket')) {
                    setError('Storage-Bucket "content" nicht gefunden. Bitte in Supabase erstellen.');
                    return;
                }
                throw uploadError;
            }

            // Get public URL
            const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
            const publicUrl = data.publicUrl;

            onUpload(publicUrl);
        } catch (e: any) {
            console.error('PDF upload error:', e);
            setError(e?.message || 'Upload fehlgeschlagen');
        } finally {
            setIsUploading(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);

        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
    };

    const handleRemove = () => {
        onRemove?.();
        setError(null);
    };

    // If we have a value, show the uploaded file
    if (value) {
        const fileName = value.split('/').pop() || 'PDF-Datei';

        return (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-green-500/30 bg-green-500/10">
                <FileText className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                        {fileName}
                    </p>
                    <p className="text-xs text-muted">PDF erfolgreich hochgeladen</p>
                </div>
                {onRemove && !disabled && (
                    <button
                        type="button"
                        onClick={handleRemove}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors"
                        title="Entfernen"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div
                onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`
          relative flex flex-col items-center justify-center gap-2 p-6
          rounded-xl border-2 border-dashed cursor-pointer
          transition-all duration-200
          ${dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}
          ${disabled || isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleInputChange}
                    disabled={disabled || isUploading}
                    className="hidden"
                />

                {isUploading ? (
                    <>
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <span className="text-sm text-muted">Wird hochgeladen...</span>
                    </>
                ) : (
                    <>
                        <Upload className="w-8 h-8 text-muted" />
                        <div className="text-center">
                            <p className="text-sm font-medium text-foreground">
                                PDF hochladen
                            </p>
                            <p className="text-xs text-muted">
                                Klicken oder hierher ziehen (max. 10MB)
                            </p>
                        </div>
                    </>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                    <span className="text-sm text-red-400">{error}</span>
                </div>
            )}
        </div>
    );
}
