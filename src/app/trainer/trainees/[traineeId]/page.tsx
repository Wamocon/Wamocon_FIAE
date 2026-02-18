import TraineeDetail from '@/components/trainer/TraineeDetail';

export default async function TraineeDetailPage({
  params,
}: {
  params: Promise<{ traineeId: string }>;
}) {
  const { traineeId } = await params;
  return <TraineeDetail traineeId={traineeId} />;
}
