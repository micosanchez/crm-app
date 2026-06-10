/** SJHC brand lockup — rooflines + silver wordmark, matches the company logo. */
export default function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg';
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 512 512" className={big ? 'h-14 w-14' : 'h-8 w-8'} aria-hidden>
        <defs>
          <linearGradient id="bm-roof" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a32650" />
            <stop offset="1" stopColor="#6d3fa4" />
          </linearGradient>
          <linearGradient id="bm-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#b9aebc" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="96" fill="#2a0a1c" />
        <path d="M86 224 L186 140 L286 224" fill="none" stroke="url(#bm-roof)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M226 224 L326 140 L426 224" fill="none" stroke="url(#bm-roof)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
        <text x="256" y="356" fontFamily="Arial, Helvetica, sans-serif" fontSize="124" fontWeight="bold" letterSpacing="2" fill="url(#bm-metal)" textAnchor="middle">SJHC</text>
        <rect x="120" y="396" width="272" height="10" rx="5" fill="url(#bm-roof)" />
      </svg>
      {big ? (
        <span className="flex flex-col leading-tight">
          <span className="text-2xl font-extrabold tracking-wide text-white">SANCHEZ</span>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-300">Junk &amp; Haul Co.</span>
        </span>
      ) : (
        <span className="font-extrabold tracking-wide text-white">
          SJHC <span className="hidden font-medium text-gray-300 sm:inline">Command Center</span>
        </span>
      )}
    </span>
  );
}
