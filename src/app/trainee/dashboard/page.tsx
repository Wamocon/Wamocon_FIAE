'use client';

import TraineeDashboard from '@/components/dashboard/TraineeDashboard';

export default function TraineeDashboardPage() {
  return (
    <TraineeDashboard
      onNavigation={(view, data) => {
        // Handle navigation for trainee dashboard
        switch (view) {
          case 'modules':
            if (data?.moduleId) {
              window.location.href = `/trainee/modules/${data.moduleId}`;
            } else {
              window.location.href = '/trainee/modules';
            }
            break;
          case 'lessons':
            if (data?.lessonId) {
              window.location.href = `/trainee/lessons/${data.lessonId}`;
            } else {
              window.location.href = '/trainee/lessons';
            }
            break;
          case 'quizzes':
            if (data?.quizId) {
              window.location.href = `/trainee/quizzes/${data.quizId}`;
            } else {
              window.location.href = '/trainee/quizzes';
            }
            break;
          case 'knowledgeSubmission':
            window.location.href = '/trainee/knowledge-submission';
            break;
          case 'reflection':
            window.location.href = '/trainee/reflection';
            break;
          default:
            console.log('Navigation:', view, data);
        }
      }}
    />
  );
}
