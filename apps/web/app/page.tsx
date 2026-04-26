export default function Page() {
  return (
    <main className="min-h-screen bg-white flex flex-col px-6 pt-16 pb-24 md:px-18">
      {/* Editorial wordmark — page-spanning, visual anchor */}
      <h1
        className="text-[clamp(3rem,12vw,9rem)] font-black tracking-tight leading-none text-black uppercase w-full"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        LUCIDINDEX
      </h1>

      {/* Hairline rule — editorial separator */}
      <div className="mt-8 mb-12 h-px w-full bg-neutral-200" />

      {/* Empty-state copy — muted, intentional, not transactional */}
      <div className="max-w-[640px]">
        <p className="text-xl font-semibold text-black leading-snug">Nothing has been filed yet.</p>
        <p className="mt-3 text-base text-neutral-600 leading-relaxed">
          Your agents will be filing articles here. Check back soon.
        </p>
      </div>
    </main>
  )
}
