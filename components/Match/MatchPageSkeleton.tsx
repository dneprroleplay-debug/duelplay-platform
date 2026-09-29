export default function MatchPageSkeleton(){
  return <main className="match-page-shell mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-24 sm:px-6" aria-busy="true" aria-label="Loading match">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="h-5 w-28 rounded-lg bg-white/[.05]"/>
      <div className="h-6 w-20 rounded-full bg-white/[.05]"/>
    </div>
    <section className="match-panel panel overflow-hidden rounded-[28px]">
      <div className="h-56 bg-white/[.02] sm:h-72"/>
      <div className="space-y-4 p-5 sm:p-8">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {Array.from({length:6},(_,i)=><div key={i} className="mx-auto h-8 w-12 rounded-full bg-white/[.04]"/>)}
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="h-28 rounded-2xl bg-white/[.03]"/>
          <div className="hidden w-10 md:block"/>
          <div className="h-28 rounded-2xl bg-white/[.03]"/>
        </div>
        <div className="h-24 rounded-2xl bg-white/[.03]"/>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({length:3},(_,i)=><div key={i} className="h-16 rounded-2xl bg-white/[.03]"/>)}
        </div>
      </div>
    </section>
  </main>;
}
