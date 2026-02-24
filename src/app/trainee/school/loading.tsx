export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-5xl space-y-6 p-6">
      <div className="h-8 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-24 rounded-xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800" />
    </div>
  );
}
