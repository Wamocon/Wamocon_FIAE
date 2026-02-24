export const trainerStats = {
  totalTrainees: 6,
  activeTrainees: 5,
  pendingReviews: 8,
  pendingReports: 3,
  avgProgress: 67,
  avgQuizScore: 79,
  completedThisWeek: 14,
  submissionsThisWeek: 23,
};

export const traineeOverview = [
  { name: 'Sarah K.', progress: 95, quizAvg: 96, status: 'excellent' as const },
  { name: 'Lisa W.', progress: 88, quizAvg: 91, status: 'excellent' as const },
  { name: 'Max M.', progress: 72, quizAvg: 84, status: 'good' as const },
  { name: 'Emma S.', progress: 62, quizAvg: 79, status: 'good' as const },
  { name: 'Tom B.', progress: 45, quizAvg: 67, status: 'warning' as const },
  { name: 'Finn H.', progress: 31, quizAvg: 58, status: 'critical' as const },
];

export const pendingItems = [
  {
    id: '1',
    type: 'report' as const,
    title: 'T\u00e4tigkeitsnachweis KW 8',
    trainee: 'Max M\u00fcller',
    date: '2026-02-21',
    priority: 'high' as const,
  },
  {
    id: '2',
    type: 'report' as const,
    title: 'T\u00e4tigkeitsnachweis KW 8',
    trainee: 'Tom Becker',
    date: '2026-02-21',
    priority: 'high' as const,
  },
  {
    id: '3',
    type: 'report' as const,
    title: 'T\u00e4tigkeitsnachweis KW 8',
    trainee: 'Emma Schulz',
    date: '2026-02-22',
    priority: 'medium' as const,
  },
  {
    id: '4',
    type: 'review' as const,
    title: 'Use Case: REST-API Entwicklung',
    trainee: 'Lisa Weber',
    date: '2026-02-23',
    priority: 'medium' as const,
  },
  {
    id: '5',
    type: 'review' as const,
    title: 'Use Case: Datenbankdesign',
    trainee: 'Sarah Klein',
    date: '2026-02-23',
    priority: 'low' as const,
  },
];

export const weeklyStats = [
  { week: 'KW 4', submissions: 18, reviews: 15 },
  { week: 'KW 5', submissions: 22, reviews: 20 },
  { week: 'KW 6', submissions: 19, reviews: 17 },
  { week: 'KW 7', submissions: 25, reviews: 22 },
  { week: 'KW 8', submissions: 23, reviews: 14 },
];

export const progressByComponent = [
  { name: 'Komp. 1', avgProgress: 92 },
  { name: 'Komp. 2', avgProgress: 85 },
  { name: 'Komp. 3', avgProgress: 68 },
  { name: 'Komp. 4', avgProgress: 52 },
  { name: 'Komp. 5', avgProgress: 38 },
  { name: 'Komp. 6', avgProgress: 22 },
  { name: 'Komp. 7', avgProgress: 8 },
  { name: 'Komp. 8', avgProgress: 3 },
];
