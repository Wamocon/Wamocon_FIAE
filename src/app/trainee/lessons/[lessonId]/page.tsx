import Lesson from '@/components/learning/Lesson';
import { getLessonWithSubLessons } from '@/db/queries';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const data = await getLessonWithSubLessons(lessonId);
  return <Lesson data={data} />;
}
