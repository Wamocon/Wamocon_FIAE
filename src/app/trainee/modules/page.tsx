import { getModulesWithCounts } from '@/db/queries';
import ModulesList from '@/components/learning/ModulesList';

export default async function TraineeModulesPage() {
  const modules = await getModulesWithCounts();
  return <ModulesList modules={modules} />;
}
