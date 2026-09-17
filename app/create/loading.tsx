export default function Loading(){
 return <main className="min-h-screen bg-[#050507] px-4 pt-28">
  <div className="mx-auto grid min-h-[620px] max-w-6xl items-center lg:grid-cols-2 lg:gap-12">
   <section className="animate-pulse"><div className="h-6 w-32 rounded-full bg-white/10"/><div className="mt-6 h-14 w-full max-w-xl rounded-xl bg-white/10"/><div className="mt-3 h-14 w-4/5 max-w-lg rounded-xl bg-pink-400/15"/><div className="mt-6 h-4 w-full max-w-xl rounded bg-white/5"/><div className="mt-2 h-4 w-3/4 max-w-lg rounded bg-white/5"/></section>
   <section className="animate-pulse rounded-3xl border border-white/10 bg-[#0b0b10] p-6"><div className="h-7 w-40 rounded bg-white/10"/><div className="mt-6 h-12 rounded-xl bg-white/5"/><div className="mt-4 h-12 rounded-xl bg-white/5"/><div className="mt-4 h-48 rounded-2xl bg-white/5"/></section>
  </div>
 </main>
}
