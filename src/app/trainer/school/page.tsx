'use client';

import { Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { TrainerSchoolView } from '@/components/trainer/TrainerSchoolView';

function SchoolPageContent() {
    const { profile, loading } = useAuth();

    if (loading) {
        return (
            <div className="bg-background flex min-h-full items-center justify-center">
                <div className="text-center">
                    <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
                    <p className="text-muted-foreground">Lade Schul-Verwaltung...</p>
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="bg-background flex min-h-full items-center justify-center">
                <div className="text-center">
                    <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
                    <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
                </div>
            </div>
        );
    }

    if (profile.role !== 'trainer') {
        return (
            <div className="bg-background flex min-h-full items-center justify-center">
                <div className="text-center">
                    <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
                    <p className="text-muted-foreground">Zugriff verweigert...</p>
                </div>
            </div>
        );
    }

    return <TrainerSchoolView />;
}

export default function TrainerSchoolPage() {
    return (
        <Suspense fallback={
            <div className="bg-background flex min-h-full items-center justify-center">
                <div className="text-center">
                    <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
                    <p className="text-muted-foreground">Lade...</p>
                </div>
            </div>
        }>
            <SchoolPageContent />
        </Suspense>
    );
}
