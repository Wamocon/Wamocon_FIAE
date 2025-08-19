'use client'

import TrainerDashboard from '@/components/dashboard/TrainerDashboard'

export default function TrainerDashboardPage() {
  return (
    <TrainerDashboard onNavigation={(view, data) => {
      // Handle navigation for trainer dashboard
      switch (view) {
        case 'trainees':
          if (data?.traineeId) {
            window.location.href = `/trainer/trainees/${data.traineeId}`
          } else {
            window.location.href = '/trainer/trainees'
          }
          break
        case 'contentManagement':
          window.location.href = '/trainer/content-management'
          break
        case 'quizManagement':
          window.location.href = '/trainer/quiz-management'
          break
        case 'analytics':
          window.location.href = '/trainer/analytics'
          break
        default:
          console.log('Navigation:', view, data)
      }
    }} />
  )
}
