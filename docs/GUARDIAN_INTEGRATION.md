# Guardian → Hearth Companion integration

For Hasan (Guardian: `github.com/HasanRaza-ui/Agents-Everywhere-Bots-Channels-More-Global-Hackathon`).

## 1. The split

Guardian is **perception only**: it watches the camera, detects a possible fall,
and decides *when* to raise a candidate. Hearth Companion (this backend) owns
everything downstream of that: it asks the check-in question, waits for an
answer, decides whether to escalate, sends the Telegram alert to the family,
and drives the family dashboard. Guardian hands us an event over HTTP; we hand
Guardian back a `question` string to speak out loud.

**Rule: Guardian never sends Telegram itself anymore.** All alerting goes
through our backend so there is exactly one place that decides "this is now a
family-visible incident" and exactly one Telegram bot sending messages. If
Guardian keeps its own `sendMessage` calls, families will get duplicate or
conflicting alerts.

## 2. HTTP contract

Both endpoints live on this Next.js app. Base URL: `APP_URL` (local dev:
`http://localhost:3000`; in production, the Vercel deployment URL).

### `POST /api/incidents`

Body — a `CompanionEvent` of type `person_on_floor_candidate`
(`src/contracts/index.ts`):

```json
{
  "type": "person_on_floor_candidate",
  "elderId": "marie",
  "confidence": 0.82,
  "note": "person appears to be lying on the floor near the sofa",
  "at": "2026-09-12T10:15:00.000Z"
}
```

- `elderId` — string, must match a seeded elder (`marie` in the demo).
- `confidence` — number in `[0, 1]`. Treat it as **an estimate, not a
  probability** — it's Guardian's own detector score, not a diagnosis.
- `note` — short human-readable string, freeform.
- `at` — ISO 8601 datetime string.

This event is a **candidate**, never a diagnosis — the backend's job (a
check-in question) exists precisely because the candidate might be wrong.

Response `200`:

```json
{
  "incidentId": "5c1b9e2e-...",
  "question": "Marie? I noticed you're on the floor. Are you okay?"
}
```

Response `400` on invalid input (missing `elderId`, `confidence` out of range,
wrong `type`, etc.) — body is `{ "error": "<zod message>" }`.

Side effects: creates an `incidents` row (status `DETECTED` → `CHECKING`),
logs `incident_detected` / `incident_checking` activity, and (if
`TRIGGER_SECRET_KEY` is configured) schedules a 20s auto-escalation in case
Guardian never posts a response.

### `POST /api/incidents/[id]/response`

Path param `id` = the `incidentId` from step above.

Body:

```json
{ "response": "I'm fine, I dropped my glasses" }
```

or, if nobody answered within Guardian's listening window:

```json
{ "response": null }
```

Response `200`: `{ "ok": true }` (or `{ "error": "..." }` with `400`/`500` on
failure).

Side effects:
- non-empty `response` → incident → `RESOLVED_OK`, logs `incident_resolved_ok`.
  No Telegram alert is sent.
- `null` (or empty string) → incident → `ESCALATED`, logs `incident_escalated`,
  and the backend sends the real Telegram alert (with an "I'm on it" button)
  to the family's approver chat.

## 3. Sequence Guardian should follow

1. Detect a possible fall. **Debounce**: only fire on 2 consecutive frames
   classified as "on floor" — don't post on a single noisy frame.
2. `POST /api/incidents` with the event above.
3. Speak the returned `question` locally, using Guardian's own TTS (no change
   needed there — the backend just gives you the text).
4. Listen for a reply for about 20 seconds using Guardian's own STT/mic
   pipeline.
5. `POST /api/incidents/{incidentId}/response` with `{ "response": "<text the
   elder said>" }`, or `{ "response": null }` if nothing was heard/understood.
6. Done. Do not call Telegram, do not decide "call the family" yourself — the
   backend has already done that as part of step 5.

If step 5 never happens (Guardian crashes, network drops, etc.) the backend's
own 20s Trigger.dev fallback will escalate the incident on its own, so a lost
response never leaves an elder without a check.

## 4. Minimal Python snippet

```python
import os
import time
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
# In production this is the Vercel deployment URL, e.g.
# https://hearth-companion.vercel.app
ELDER_ID = os.environ.get("ELDER_ID", "marie")


def report_fall_candidate(confidence: float, note: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/incidents",
        json={
            "type": "person_on_floor_candidate",
            "elderId": ELDER_ID,
            "confidence": confidence,  # an estimate, not a probability
            "note": note,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()  # { "incidentId": ..., "question": ... }


def report_check_in_response(incident_id: str, response_text: str | None) -> None:
    resp = requests.post(
        f"{BASE_URL}/api/incidents/{incident_id}/response",
        json={"response": response_text},
        timeout=10,
    )
    resp.raise_for_status()


# Example flow after Guardian's detector fires on 2 consecutive frames:
result = report_fall_candidate(
    confidence=0.82,
    note="person appears to be lying on the floor near the sofa",
)
incident_id = result["incidentId"]
question = result["question"]

guardian_tts.speak(question)          # Guardian's own TTS — unchanged
heard = guardian_stt.listen(seconds=20)  # Guardian's own STT — unchanged

report_check_in_response(incident_id, heard)  # heard is str or None
```

## 5. Try it yourself

Run the same flow this doc describes, end to end, against a running
`npx next dev` instance:

```bash
npx tsx scripts/simulate-fall.ts
```

It POSTs a `person_on_floor_candidate` event, escalates it with a null
response, acknowledges it, then runs a second incident where the elder
answers and it resolves without escalating. Reading it is the fastest way to
see exactly what the backend expects and returns at each step.

## 6. What shows up where

| Step | Family dashboard (`/family`) | Telegram |
|---|---|---|
| Guardian posts the candidate | Activity feed: "Noticed something and is checking in." then "Waiting to hear back." Incident appears in Alerts as `CHECKING`. | nothing yet |
| Elder answers ("I'm fine...") | Activity feed: "Responded and is okay." Incident moves to `RESOLVED_OK`. | nothing — no alert is sent |
| No answer / `response: null` | Activity feed: "No response — alerting family." Incident moves to `ESCALATED`. | A message naming the incident, with confidence shown as an estimate, and an **"I'm on it"** button |
| Family taps "I'm on it" (or `POST /api/dev/tap`) | Activity feed: "Family member is on it." Incident moves to `ACKNOWLEDGED`. | Telegram message is edited to reflect the result |
