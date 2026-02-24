export default function Loading() {
  return (
    <div className="animate-pulse mx-auto max-w-4xl space-y-6 p-6">
      <div className="h-8 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-4 w-72 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white p-12 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-64 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  );
}
