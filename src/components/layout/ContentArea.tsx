'use client';

import { useAuth } from '@/contexts/AuthContext';
import TraineeDashboard from '../dashboard/TraineeDashboard';
import TrainerDashboard from '../dashboard/TrainerDashboard';
import { ModuleDetail } from '../learning/ModuleDetail';
import { ChapterDetail } from '../learning/ChapterDetail';
import { Lesson } from '../learning/Lesson';
import { Quiz } from '../learning/Quiz';
import { KnowledgeSubmission } from '../learning/KnowledgeSubmission';
import { Reflection } from '../learning/Reflection';
import { Profile } from '../profile/Profile';
import { TraineeDetail } from '../trainer/TraineeDetail';
import { AcceptanceProtocol } from '../trainer/AcceptanceProtocol';
import { ContentManagement } from '../trainer/ContentManagement';
import { QuizManagement } from '../trainer/QuizManagement';

interface ContentAreaProps {
  currentView: string;
  profile: any;
  onNavigation: (view: string, data?: any) => void;
}

export function ContentArea({
  currentView,
  profile,
  onNavigation,
}: ContentAreaProps) {
  const role = profile?.role || 'trainee';

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return role === 'trainee' ? (
          <TraineeDashboard onNavigation={onNavigation} />
        ) : (
          <TrainerDashboard onNavigation={onNavigation} />
        );

      case 'moduleDetail':
        return <ModuleDetail moduleId="default" onNavigation={onNavigation} />;

      case 'chapterDetail':
        return <ChapterDetail onNavigation={onNavigation} />;

      case 'lesson':
        return <Lesson onNavigation={onNavigation} />;

      case 'quiz':
        return <Quiz onNavigation={onNavigation} />;

      case 'knowledgeSubmission':
        return <KnowledgeSubmission />;

      case 'reflection':
        return <Reflection />;

      case 'profile':
        return <Profile />;

      case 'traineeDetail':
        return <TraineeDetail onNavigation={onNavigation} />;

      case 'acceptanceProtocol':
        return <AcceptanceProtocol />;

      case 'contentManagement':
        return <ContentManagement />;

      case 'quizManagement':
        return <QuizManagement />;

      default:
        return (
          <div className="p-8 text-center text-gray-500">
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-700">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"></div>
              </div>
              <h2 className="mb-2 text-2xl font-semibold text-gray-300">
                Diese Ansicht befindet sich im Aufbau
              </h2>
              <p className="text-gray-500">
                Bitte wählen Sie eine andere Option aus dem Menü.
              </p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="bg-background flex-1 overflow-y-auto">
      {renderContent()}
    </div>
  );
}
