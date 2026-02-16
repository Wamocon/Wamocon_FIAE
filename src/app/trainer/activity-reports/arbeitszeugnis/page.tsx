import dynamic from 'next/dynamic';

const ArbeitszeugnisGenerator = dynamic(
  () =>
    import('@/components/trainer/arbeitszeugnis/ArbeitszeugnisGenerator').then(
      m => m.ArbeitszeugnisGenerator
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    ),
  }
);

export default function ArbeitszeugnisPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <ArbeitszeugnisGenerator />
    </div>
  );
}
