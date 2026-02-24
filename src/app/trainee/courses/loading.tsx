export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-7xl space-y-8 p-6">
      <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-3xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="h-5 w-40 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-3 h-2 w-full rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-2 flex justify-between">
              <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
