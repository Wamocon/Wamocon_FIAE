import TraineeDetail from '@/components/trainer/TraineeDetail';

export default function TraineeDetailPage({
  params,
}: {
  params: { traineeId: string };
}) {
  const { traineeId } = params;
  return <TraineeDetail traineeId={traineeId} />;
}
