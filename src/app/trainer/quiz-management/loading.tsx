export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-10 w-36 rounded-xl bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-3xl border border-gray-100 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-5 w-44 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-2 h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="h-8 w-20 rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
