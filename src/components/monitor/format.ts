import type { Activity, ActivityKind } from "@/contracts";
import type { CompanionStatus } from "@/components/room/StatusWord";
import type { IncidentPhase } from "@/components/room/useCompanion";
import type { LiveSessionState } from "@/components/room/LiveVoice";

export type Tone = "teal" | "amber" | "danger" | "muted";

export const TONE_TEXT: Record<Tone, string> = {
  teal: "text-[#2dd4bf]",
  amber: "text-[#f5b301]",
  danger: "text-[#f43f5e]",
  muted: "text-[#7d8b99]",
};

export const TONE_BG: Record<Tone, string> = {
  teal: "bg-[#2dd4bf]",
  amber: "bg-[#f5b301]",
  danger: "bg-[#f43f5e]",
  muted: "bg-[#7d8b99]",
};

export const TONE_BORDER: Record<Tone, string> = {
  teal: "border-[#2dd4bf]",
  amber: "border-[#f5b301]",
  danger: "border-[#f43f5e]",
  muted: "border-[#1c2a36]",
};

const STATUS_FR: Record<CompanionStatus, string> = {
  Resting: "Repos",
  "Waking…": "Réveil…",
  Listening: "Écoute",
  "Thinking…": "Réflexion…",
  Speaking: "Parle",
  "Checking on you…": "Vérification…",
};

export function statusWordFr(status: CompanionStatus): string {
  return STATUS_FR[status] ?? status;
}

export function cameraChip(
  phase: IncidentPhase,
  lastSample: { posture: string; streak: number } | null
): { text: string; tone: Tone } {
  if (phase === "escalated" || phase === "acknowledged") return { text: "Alerte envoyée", tone: "danger" };
  if (phase === "checking") return { text: "Vérification", tone: "amber" };
  if (phase === "detected") return { text: "Chute possible", tone: "amber" };
  if (lastSample && (lastSample.posture === "on_floor" || lastSample.posture === "lying") && lastSample.streak >= 1) {
    return { text: "Chute possible", tone: "amber" };
  }
  return { text: "Activité normale", tone: "teal" };
}

export function statePill(
  phase: IncidentPhase,
  liveState: LiveSessionState
): { text: string; tone: Tone } {
  if (phase === "escalated" || phase === "acknowledged") return { text: "ALERTE", tone: "danger" };
  if (phase === "detected" || phase === "checking") return { text: "VÉRIFICATION", tone: "amber" };
  if (phase === "none" && liveState === "asleep") return { text: "REPOS", tone: "muted" };
  return { text: "MONITORING", tone: "teal" };
}

export function phaseHeadline(phase: IncidentPhase): { title: string; line: string } {
  switch (phase) {
    case "detected":
      return { title: "Chute possible détectée", line: "Confirmation sur deux images consécutives." };
    case "checking":
      return { title: "Vérification en cours", line: "L'agent demande : « Marie, est-ce que ça va ? »" };
    case "escalated":
      return { title: "Alerte envoyée à Claire", line: "Photo de la pièce transmise sur Telegram." };
    case "acknowledged":
      return { title: "Claire est prévenue", line: "Elle a confirmé qu'elle s'en occupe." };
    case "resolved":
      return { title: "Fausse alerte levée", line: "Marie a répondu qu'elle allait bien." };
    case "none":
    default:
      return { title: "Surveillance active", line: "L'agent analyse le flux vidéo. Aucun incident détecté." };
  }
}

export type WorkflowStep = 1 | 2 | 3 | 4 | 5;

export const WORKFLOW_STEPS: { n: WorkflowStep; label: string; sub: string }[] = [
  { n: 1, label: "Surveillance", sub: "Analyse vidéo continue" },
  { n: 2, label: "Chute détectée", sub: "Vérification du signal" },
  { n: 3, label: "Attente", sub: "Fenêtre de récupération" },
  { n: 4, label: "Appel", sub: "Contact de la personne" },
  { n: 5, label: "Alerte", sub: "Escalade vers un proche" },
];

export function activeWorkflowStep(phase: IncidentPhase, liveState: LiveSessionState): WorkflowStep {
  switch (phase) {
    case "detected":
      return 2;
    case "checking":
      return liveState === "awake" ? 4 : 3;
    case "escalated":
    case "acknowledged":
      return 5;
    case "resolved":
    case "none":
    default:
      return 1;
  }
}

interface ActivityLine {
  text: string;
  tone: Tone;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function activityLineFr(row: Activity): ActivityLine {
  const kind: ActivityKind = row.kind;
  switch (kind) {
    case "utterance":
      return { text: `Marie : « ${truncate(row.message, 60)} »`, tone: "muted" };
    case "basket_built":
      return { text: "Panier préparé", tone: "muted" };
    case "within_budget":
      return { text: "Dans le budget", tone: "muted" };
    case "over_budget":
      return { text: "Dépassement du budget hebdomadaire", tone: "amber" };
    case "approval_requested":
      return { text: "Approbation demandée à Claire", tone: "muted" };
    case "approval_approved":
      return { text: "Claire a approuvé", tone: "teal" };
    case "approval_rejected":
      return { text: "Claire a refusé", tone: "danger" };
    case "approval_expired":
      return { text: "Approbation expirée", tone: "muted" };
    case "approval_duplicate_tap_ignored":
      return { text: "Second appui ignoré", tone: "muted" };
    case "payment_processing":
      return { text: "Paiement en cours", tone: "muted" };
    case "payment_succeeded":
      return { text: "Paiement effectué", tone: "teal" };
    case "payment_failed":
      return { text: "Paiement refusé", tone: "danger" };
    case "companion_said":
      return { text: `Hearth : « ${truncate(row.message, 60)} »`, tone: "teal" };
    case "incident_detected":
      return { text: "Chute possible détectée", tone: "amber" };
    case "incident_checking":
      return { text: "Vérification en cours", tone: "amber" };
    case "incident_resolved_ok":
      return { text: "Fausse alerte — la personne va bien", tone: "teal" };
    case "incident_escalated":
      return { text: "Assistance urgente déclenchée", tone: "danger" };
    case "incident_acknowledged":
      return { text: "Claire s'en occupe", tone: "teal" };
    case "refill_requested":
      return { text: "Renouvellement demandé", tone: "muted" };
    case "refill_confirmed":
      return { text: "Renouvellement confirmé", tone: "muted" };
    default:
      return { text: row.message, tone: "muted" };
  }
}
