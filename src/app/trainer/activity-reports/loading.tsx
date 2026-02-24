export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-5xl space-y-6 p-6">
      <div className="h-8 w-56 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-2 h-8 w-12 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex justify-between">
              <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-5 w-20 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mt-2 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
