'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams, useRouter } from 'next/navigation';
import {
    Calendar,
    ClipboardCheck,
    FileText,
    School,
    Users,
} from 'lucide-react';
import { TrainerCalendarTab } from './school/TrainerCalendarTab';
import { TrainerExamsTab } from './school/TrainerExamsTab';

type TabId = 'calendar' | 'exams';

interface TabConfig {
    id: TabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
}

const TABS: TabConfig[] = [
    {
        id: 'calendar',
        label: 'Trainee-Kalender',
        icon: Calendar,
        description: 'Blockertermine für Trainees verwalten',
    },
    {
        id: 'exams',
        label: 'Prüfungen',
        icon: FileText,
        description: 'Prüfungsergebnisse und Bewertungen',
    },
];

export function TrainerSchoolView() {
    const { profile } = useAuth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<TabId>('calendar');
    const [stats, setStats] = useState({ pendingReports: 0, upcomingExams: 0, trainees: 0 });

    useEffect(() => {
        const tabParam = searchParams.get('tab') as TabId;
        if (tabParam && TABS.some(t => t.id === tabParam)) {
            setActiveTab(tabParam);
        }
    }, [searchParams]);

    useEffect(() => {
        if (!profile?.id) return;
        async function loadStats() {
            try {
                const res = await fetch(`/api/trainer/school/stats?trainerId=${profile.id}`);
                if (res.ok) {
                    const data = await res.json();
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load stats:', e);
            }
        }
        loadStats();
    }, [profile?.id]);

    const handleTabChange = (tabId: TabId) => {
        setActiveTab(tabId);
        router.push(`/trainer/school?tab=${tabId}`, { scroll: false });
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'calendar':
                return <TrainerCalendarTab />;
            case 'exams':
                return <TrainerExamsTab />;
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen p-4 md:p-6 lg:p-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-foreground md:text-3xl flex items-center gap-3">
                    <School className="h-7 w-7 text-accent" />
                    Berufsschul-Verwaltung
                </h1>
                <p className="text-muted-foreground mt-1">
                    Verwalte Kalender, Tätigkeitsnachweise und Prüfungen deiner Trainees
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-xl glass-effect border border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-amber-500/10">
                            <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{stats.pendingReports}</p>
                            <p className="text-xs text-muted-foreground">Ausstehende Nachweise</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 rounded-xl glass-effect border border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-rose-500/10">
                            <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{stats.upcomingExams}</p>
                            <p className="text-xs text-muted-foreground">Anstehende Prüfungen</p>
                        </div>
                    </div>
                </div>
                <div className="p-4 rounded-xl glass-effect border border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-accent/10">
                            <Users className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{stats.trainees}</p>
                            <p className="text-xs text-muted-foreground">Aktive Trainees</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-6">
                <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-muted/50">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                                    }`}
                            >
                                <Icon className={`h-4 w-4 ${isActive ? 'text-accent' : ''}`} />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
                <p className="text-xs text-muted-foreground mt-2 px-1">
                    {TABS.find(t => t.id === activeTab)?.description}
                </p>
            </div>

            {/* Tab Content */}
            <div className="rounded-2xl glass-effect border border-border p-6">
                {renderTabContent()}
            </div>
        </div>
    );
}
