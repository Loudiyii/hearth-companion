import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 p-8">
      <Link
        href="/room"
        className="flex w-full max-w-md items-center justify-center rounded-2xl bg-zinc-900 px-10 py-16 text-3xl font-medium text-zinc-50 transition-colors hover:bg-zinc-800"
      >
        Marie&rsquo;s room
      </Link>
      <Link
        href="/family"
        className="flex w-full max-w-md items-center justify-center rounded-2xl border border-zinc-300 bg-white px-10 py-16 text-3xl font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
      >
        Family
      </Link>
      <Link
        href="/monitor"
        className="flex w-full max-w-md items-center justify-center rounded-2xl border border-zinc-300 bg-white px-10 py-16 text-3xl font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
      >
        Monitor
      </Link>
    </div>
  );
}
