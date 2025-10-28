import TraineeDetail from '@/components/trainer/TraineeDetail';

export default function TraineeDetailPage({
  params,
}: {
  params: { traineeId: string };
}) {
  return <TraineeDetail traineeId={params.traineeId} />;
}
