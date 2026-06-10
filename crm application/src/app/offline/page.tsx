export default function OfflinePage() {
  return (
    <div className="mx-auto mt-20 max-w-sm text-center">
      <p className="text-5xl">📡</p>
      <h1 className="mt-4 text-xl font-bold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-gray-500">
        This page isn&apos;t cached yet. Any changes you made are queued locally
        and will sync automatically once you&apos;re back online.
      </p>
    </div>
  );
}
