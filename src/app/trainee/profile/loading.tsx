export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div>
          <div className="h-6 w-40 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-2 h-4 w-56 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-3 h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      ))}
    </div>
  );
}
