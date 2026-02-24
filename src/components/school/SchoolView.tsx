'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSearchParams, useRouter } from 'next/navigation';
import {
    Calendar,
    FileText,
    BookOpen,
    ClipboardCheck,
    ChevronRight,
    AlertCircle,
    CheckCircle2,
    Clock,
    FileSpreadsheet,
    Layers,
} from 'lucide-react';
import { BlockCalendar } from './BlockCalendar';
import { ExamManager } from './ExamManager';
import { ActivityReportsList } from './ActivityReportsList';
import { LernfeldNotes } from './LernfeldNotes';
import { LernfelderTab } from './LernfelderTab';

type TabId = 'lernfelder' | 'calendar' | 'exams' | 'notes' | 'reports';

interface TabConfig {
    id: TabId;
    labelKey: string;
    descKey: string;
    icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabConfig[] = [
    {
        id: 'lernfelder',
        labelKey: 'school.tabs.lernfelder',
        descKey: 'school.tabs.lernfelderDesc',
        icon: Layers,
    },
    {
        id: 'calendar',
        labelKey: 'school.tabs.calendar',
        descKey: 'school.tabs.calendarDesc',
        icon: Calendar,
    },
    {
        id: 'exams',
        labelKey: 'school.tabs.exams',
        descKey: 'school.tabs.examsDesc',
        icon: FileText,
    },
    {
        id: 'notes',
        labelKey: 'school.tabs.notes',
        descKey: 'school.tabs.notesDesc',
        icon: BookOpen,
    },
];

export function SchoolView() {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();

    // Get tab from URL or default to calendar
    const tabParam = searchParams.get('tab') as TabId | null;
    const [activeTab, setActiveTab] = useState<TabId>(
        tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'lernfelder'
    );

    // Stats for quick overview
    const [stats, setStats] = useState({
        upcomingExams: 0,
        pendingReports: 0,
        currentBlock: null as string | null,
        averageGrade: null as string | null,
    });
    const [loading, setLoading] = useState(true);

    // Update URL when tab changes
    const handleTabChange = (tabId: TabId) => {
        setActiveTab(tabId);
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', tabId);
        router.push(`?${params.toString()}`, { scroll: false });
    };

    // Load overview stats
    useEffect(() => {
        if (!profile?.id) return;

        const loadStats = async () => {
            try {
                // Fetch upcoming exams
                const examsRes = await fetch(
                    `/api/trainee/school/exams?traineeId=${profile.id}&upcoming=true&limit=5`
                );
                const examsData = examsRes.ok ? await examsRes.json() : { exams: [] };

                // Fetch pending reports
                const reportsRes = await fetch(
                    `/api/trainee/school/reports?traineeId=${profile.id}`
                );
                const reportsData = reportsRes.ok ? await reportsRes.json() : { meta: {} };

                // Fetch current block
                const now = new Date();
                const blocksRes = await fetch(
                    `/api/trainee/school/blocks?traineeId=${profile.id}&year=${now.getFullYear()}`
                );
                const blocksData = blocksRes.ok ? await blocksRes.json() : { blocks: [] };
                const today = now.getTime();
                const activeBlock = (blocksData.blocks || []).find((b: any) => {
                    const start = new Date(b.startDate).getTime();
                    const end = new Date(b.endDate).getTime();
                    return today >= start && today <= end;
                });
                const blockLabel = activeBlock
                    ? activeBlock.title || activeBlock.blockType
                    : null;

                setStats({
                    upcomingExams: examsData.exams?.length || 0,
                    pendingReports: reportsData.meta?.stats?.draft || 0,
                    currentBlock: blockLabel,
                    averageGrade: null,
                });
            } catch (e) {
                console.error('Failed to load stats:', e);
            } finally {
                setLoading(false);
            }
        };

        loadStats();
    }, [profile?.id]);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'lernfelder':
                return <LernfelderTab />;
            case 'calendar':
                return <BlockCalendar />;
            case 'exams':
                return <ExamManager />;
            case 'notes':
                return <LernfeldNotes />;

            default:
                return <LernfelderTab />;
        }
    };

    return (
        <div className="min-h-full p-4 md:p-6 lg:p-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-foreground md:text-3xl">
                    {t('school.title')}
                </h1>
                <p className="text-muted-foreground mt-1">
                    {t('school.description')}
                </p>
            </div>

            {/* Quick Stats Cards */}
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                <div className="glass-effect rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-accent/20 p-2">
                            <FileText className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">{t('school.stats.upcomingExams')}</p>
                            <p className="text-xl font-bold text-foreground">
                                {loading ? '...' : stats.upcomingExams}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="glass-effect rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-amber-500/20 p-2">
                            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">{t('school.stats.pendingReports')}</p>
                            <p className="text-xl font-bold text-foreground">
                                {loading ? '...' : stats.pendingReports}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="glass-effect rounded-xl p-4 transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-green-500/20 p-2">
                            <Calendar className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">{t('school.stats.currentBlock')}</p>
                            <p className="text-lg font-bold text-foreground">
                                {loading ? '...' : stats.currentBlock || '—'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="mb-6 overflow-x-auto">
                <div className="flex gap-2 min-w-max pb-2">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                className={`
                                    flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium
                                    transition-all duration-200 border
                                    ${isActive
                                        ? 'btn-accent border-accent'
                                        : 'glass-effect border-border text-foreground hover:border-accent/30'
                                    }
                                `}
                            >
                                <Icon className={`h-4 w-4 ${isActive ? 'text-primary-foreground' : ''}`} />
                                <span>{t(tab.labelKey)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tab Content */}
            <div className="glass-effect overflow-visible rounded-2xl p-4 md:p-6">
                {renderTabContent()}
            </div>
        </div>
    );
}
