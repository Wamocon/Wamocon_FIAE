export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-8 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="mb-3 h-5 w-36 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mb-2 h-4 w-20 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
