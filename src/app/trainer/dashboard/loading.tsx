export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-8 w-32 rounded bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Stats cards skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="mb-2 h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-8 w-12 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800" />
        <div className="h-72 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800" />
      </div>

      {/* Trainees list skeleton */}
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 h-6 w-32 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1">
                <div className="mb-1 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-2 w-full rounded bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
