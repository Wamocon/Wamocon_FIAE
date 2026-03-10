export interface TourStep {
  id: string;
  targetSelector: string;
  titleKey: string;
  descriptionKey: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export const TRAINEE_MAIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    targetSelector: '[data-tour="sidebar-logo"]',
    titleKey: 'onboarding.welcome.title',
    descriptionKey: 'onboarding.welcome.desc',
    placement: 'right',
  },
  {
    id: 'dashboard',
    targetSelector: '[data-tour="sidebar-dashboard"]',
    titleKey: 'onboarding.dashboard.title',
    descriptionKey: 'onboarding.trainee.dashboard.desc',
    placement: 'right',
  },
  {
    id: 'courses',
    targetSelector: '[data-tour="sidebar-courses"]',
    titleKey: 'onboarding.courses.title',
    descriptionKey: 'onboarding.courses.desc',
    placement: 'right',
  },
  {
    id: 'quizzes',
    targetSelector: '[data-tour="sidebar-quizzes"]',
    titleKey: 'onboarding.quizzes.title',
    descriptionKey: 'onboarding.trainee.quizzes.desc',
    placement: 'right',
  },
  {
    id: 'activity-reports',
    targetSelector: '[data-tour="sidebar-activityReports"]',
    titleKey: 'onboarding.activityReports.title',
    descriptionKey: 'onboarding.trainee.activityReports.desc',
    placement: 'right',
  },
  {
    id: 'trainer-feedback',
    targetSelector: '[data-tour="sidebar-lessons"]',
    titleKey: 'onboarding.trainerFeedback.title',
    descriptionKey: 'onboarding.trainerFeedback.desc',
    placement: 'right',
  },
  {
    id: 'notifications',
    targetSelector: '[data-tour="header-notifications"]',
    titleKey: 'onboarding.notifications.title',
    descriptionKey: 'onboarding.notifications.desc',
    placement: 'bottom',
  },
  {
    id: 'settings',
    targetSelector: '[data-tour="header-settings"]',
    titleKey: 'onboarding.settings.title',
    descriptionKey: 'onboarding.settings.desc',
    placement: 'bottom',
  },
];

export const TRAINEE_HAI_STEPS: TourStep[] = [
  {
    id: 'hai-intro',
    targetSelector: '[data-tour="hai-button"]',
    titleKey: 'onboarding.hai.intro.title',
    descriptionKey: 'onboarding.trainee.hai.intro.desc',
    placement: 'left',
  },
  {
    id: 'hai-features',
    targetSelector: '[data-tour="hai-button"]',
    titleKey: 'onboarding.hai.features.title',
    descriptionKey: 'onboarding.trainee.hai.features.desc',
    placement: 'left',
  },
];

export const TRAINER_MAIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    targetSelector: '[data-tour="sidebar-logo"]',
    titleKey: 'onboarding.welcome.title',
    descriptionKey: 'onboarding.welcome.desc',
    placement: 'right',
  },
  {
    id: 'dashboard',
    targetSelector: '[data-tour="sidebar-dashboard"]',
    titleKey: 'onboarding.dashboard.title',
    descriptionKey: 'onboarding.trainer.dashboard.desc',
    placement: 'right',
  },
  {
    id: 'content-management',
    targetSelector: '[data-tour="sidebar-contentManagement"]',
    titleKey: 'onboarding.contentManagement.title',
    descriptionKey: 'onboarding.contentManagement.desc',
    placement: 'right',
  },
  {
    id: 'quiz-management',
    targetSelector: '[data-tour="sidebar-quizManagement"]',
    titleKey: 'onboarding.quizManagement.title',
    descriptionKey: 'onboarding.quizManagement.desc',
    placement: 'right',
  },
  {
    id: 'trainees',
    targetSelector: '[data-tour="sidebar-trainees"]',
    titleKey: 'onboarding.trainees.title',
    descriptionKey: 'onboarding.trainees.desc',
    placement: 'right',
  },
  {
    id: 'activity-reports',
    targetSelector: '[data-tour="sidebar-activityReports"]',
    titleKey: 'onboarding.activityReports.title',
    descriptionKey: 'onboarding.trainer.activityReports.desc',
    placement: 'right',
  },
  {
    id: 'notifications',
    targetSelector: '[data-tour="header-notifications"]',
    titleKey: 'onboarding.notifications.title',
    descriptionKey: 'onboarding.notifications.desc',
    placement: 'bottom',
  },
  {
    id: 'settings',
    targetSelector: '[data-tour="header-settings"]',
    titleKey: 'onboarding.settings.title',
    descriptionKey: 'onboarding.settings.desc',
    placement: 'bottom',
  },
];

export const TRAINER_HAI_STEPS: TourStep[] = [
  {
    id: 'hai-intro',
    targetSelector: '[data-tour="hai-button"]',
    titleKey: 'onboarding.hai.intro.title',
    descriptionKey: 'onboarding.trainer.hai.intro.desc',
    placement: 'left',
  },
  {
    id: 'hai-features',
    targetSelector: '[data-tour="hai-button"]',
    titleKey: 'onboarding.hai.features.title',
    descriptionKey: 'onboarding.trainer.hai.features.desc',
    placement: 'left',
  },
];
