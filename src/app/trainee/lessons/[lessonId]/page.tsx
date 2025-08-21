'use client'

import Lesson from '@/components/learning/Lesson'

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params
  return <Lesson lessonId={lessonId} />
}
