export type CompanionStatus =
  | "Resting"
  | "Waking…"
  | "Listening"
  | "Thinking…"
  | "Speaking"
  | "Checking on you…";

export function StatusWord({ status }: { status: CompanionStatus }) {
  return (
    <p className="select-none text-center text-6xl font-light tracking-wide text-zinc-300 sm:text-7xl">
      {status}
    </p>
  );
}
