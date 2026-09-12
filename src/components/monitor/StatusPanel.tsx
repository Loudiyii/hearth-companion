"use client";

import type { IncidentPhase } from "@/components/room/useCompanion";
import type { LiveSessionState } from "@/components/room/LiveVoice";
import type { CompanionStatus } from "@/components/room/StatusWord";
import { TONE_BORDER, TONE_TEXT, phaseHeadline, statePill, statusWordFr } from "./format";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2dd4bf" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

import { useEffect, useRef } from "react";
import type { ConversationEntry } from "./useConversationLog";

export function StatusPanel({
  incidentPhase,
  liveState,
  status,
  demoMode,
  onForceFall,
  onPersonGotUp,
  onTriggerAlert,
  onReset,
  conversation,
}: {
  incidentPhase: IncidentPhase;
  liveState: LiveSessionState;
  status: CompanionStatus;
  demoMode: boolean;
  onForceFall: () => void;
  onPersonGotUp: () => void;
  onTriggerAlert: () => void;
  onReset: () => void;
  conversation: ConversationEntry[];
}) {
  const pill = statePill(incidentPhase, liveState);
  const { title, line } = phaseHeadline(incidentPhase);
  const checking = incidentPhase === "checking";

  return (
    <div className="flex flex-col rounded-xl border border-[#1c2a36] bg-[#0f1a24] p-4">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-medium tracking-wider text-[#7d8b99]">ÉTAT ACTUEL</p>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${TONE_BORDER[pill.tone]} ${TONE_TEXT[pill.tone]}`}
        >
          {pill.text}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#2dd4bf]/10">
          <EyeIcon />
        </div>
        <div>
          <p className="text-base font-medium text-[#e6edf3]">{title}</p>
          <p className="mt-1 text-sm text-[#7d8b99]">{line}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-[#7d8b99]">
        Voix : <span className="text-[#e6edf3]">{statusWordFr(status)}</span>
      </p>

      {demoMode && (
        <div className="mt-5 border-t border-[#1c2a36] pt-4">
          <p className="mb-2 text-[11px] font-medium tracking-wider text-[#7d8b99]">CONTRÔLES DE DÉMO</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onForceFall}
              className="rounded-lg border border-[#f43f5e]/40 bg-[#f43f5e]/10 px-3 py-2 text-xs font-medium text-[#f43f5e] transition-colors hover:bg-[#f43f5e]/20"
            >
              Simuler une chute
            </button>
            <button
              type="button"
              onClick={onPersonGotUp}
              disabled={!checking}
              className="rounded-lg border border-[#1c2a36] bg-[#0a1118] px-3 py-2 text-xs font-medium text-[#e6edf3] transition-colors hover:border-[#2dd4bf]/50 disabled:opacity-30"
            >
              La personne se relève
            </button>
            <button
              type="button"
              onClick={onTriggerAlert}
              disabled={!checking}
              className="rounded-lg border border-[#1c2a36] bg-[#0a1118] px-3 py-2 text-xs font-medium text-[#e6edf3] transition-colors hover:border-[#2dd4bf]/50 disabled:opacity-30"
            >
              Déclencher l&rsquo;alerte
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg border border-[#1c2a36] bg-[#0a1118] px-3 py-2 text-xs font-medium text-[#e6edf3] transition-colors hover:border-[#2dd4bf]/50"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      )}

      <ConversationLog entries={conversation} />
    </div>
  );
}

function ConversationLog({ entries }: { entries: ConversationEntry[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);
  return (
    <div className="mt-5 border-t border-[#1c2a36] pt-4">
      <p className="mb-2 text-[11px] font-medium tracking-wider text-[#7d8b99]">CONVERSATION</p>
      <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1 text-sm">
        {entries.length === 0 && <p className="text-xs text-[#7d8b99]">Aucun échange pour l&rsquo;instant.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-2">
            <span className="shrink-0 font-mono text-[11px] text-[#7d8b99]">
              {new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <p className={e.role === "hearth" ? "text-[#2dd4bf]" : "text-[#e6edf3]"}>
              <span className="mr-1 text-[#7d8b99]">{e.role === "hearth" ? "Hearth" : "Marie"} ·</span>
              {e.text}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
