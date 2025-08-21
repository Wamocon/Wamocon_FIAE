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
          <div className="text-center text-gray-500 p-8">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h2 className="text-2xl font-semibold text-gray-300 mb-2">
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
    <div className="flex-1 overflow-y-auto bg-background">
      {renderContent()}
    </div>
  );
}
