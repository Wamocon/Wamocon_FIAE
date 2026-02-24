export default function Loading() {
  return (
    <div className="animate-pulse container max-w-5xl mx-auto py-8 space-y-6">
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gray-200 dark:bg-gray-700" />
        <div>
          <div className="h-7 w-56 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-2 h-4 w-80 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="h-8 w-12 mx-auto rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-2 h-3 w-16 mx-auto rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      <div className="h-10 w-full rounded-lg bg-gray-200 dark:bg-gray-700" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex justify-between">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-gray-200 dark:bg-gray-700" />
                <div>
                  <div className="h-5 w-36 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-1 h-3 w-48 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              </div>
              <div className="h-7 w-24 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
