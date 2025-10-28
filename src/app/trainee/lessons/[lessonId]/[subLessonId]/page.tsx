import { getSubLessonWithLesson } from '@/db/queries';
import SubLesson from '@/components/learning/SubLesson';

export default async function SubLessonPage({ params }: { params: Promise<{ lessonId: string; subLessonId: string }> }) {
  const { lessonId, subLessonId } = await params;
  const data = await getSubLessonWithLesson(subLessonId);
  // Optional: ensure the URL's lessonId matches the subLesson's parent
  if (data && data.lesson.id !== lessonId) {
    // Mismatch: do a soft guard by returning not found-like UI
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Aufgabe gehört nicht zu dieser Lektion.</p>
        </div>
      </div>
    );
  }
  return <SubLesson data={data} />;
}
