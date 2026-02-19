export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-10 w-36 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="h-5 w-40 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-6 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mb-2 h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
