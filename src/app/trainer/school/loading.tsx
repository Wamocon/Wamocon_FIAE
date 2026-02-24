export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-5xl space-y-6 p-6">
      <div className="h-8 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="flex gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-9 w-28 rounded-xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex justify-between">
              <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-5 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
