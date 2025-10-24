import ModuleDetail from '@/components/learning/ModuleDetail';
import { getModuleWithLessons } from '@/db/queries';

export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const data = await getModuleWithLessons(moduleId);
  return <ModuleDetail data={data} />;
}
