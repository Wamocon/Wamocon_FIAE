export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-5xl space-y-6 p-6">
      <div className="h-8 w-56 rounded bg-gray-200 dark:bg-gray-700" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-3xl border border-gray-100 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="h-5 w-36 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-4 space-y-3">
            {[...Array(2)].map((_, j) => (
              <div key={j} className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-2 h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
