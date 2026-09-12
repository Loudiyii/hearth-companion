# Voice: GPT-Live (primary) + Realtime (fallback)

**GPT-Live** is OpenAI's newer full-duplex voice product. Unlike Realtime, the spoken
conversation itself runs on OpenAI's side (`gpt-live-1`); when the model decides it needs
backend help mid-conversation, it hands off via **client delegation** instead of calling a
tool directly.

## Client delegation flow in this app

1. Browser opens a WebRTC connection: `RTCPeerConnection`, mic tracks added, data channel
   `"oai-events"` created *before* the offer, then `POST /api/live/session { sdp }`.
2. `src/app/api/live/session/route.ts` calls `client.live.create({ session, transport })`
   with `getOpenAI()` and returns the SDP answer (HTTP 201). The API key never leaves the
   server.
3. Once `session.started` arrives on the data channel, Marie can talk. User speech arrives
   as `session.input_transcript.delta` fragments; `src/components/room/LiveVoice.tsx`
   accumulates them into a rolling buffer (last ~600 chars).
4. When GPT-Live needs help (groceries, orders, pills/refills, pharmacy, appointments,
   contacting family), it emits `session.delegation.created` with an opaque
   `delegation.id` — no task text, just a signal.
5. `LiveVoice` posts the buffered user transcript to `POST /api/agent { elderId, text }`
   (the existing agent tool loop) and resets the buffer.
6. The agent's `reply` is sent back with
   `{ type: "session.commentary.append", delegation_id, content: reply }` (≤1500 chars),
   which GPT-Live paraphrases aloud to Marie. On failure it sends a graceful fallback
   line instead of crashing the call.
7. `session.close` → wait for `session.closed` → close the peer connection and stop the
   mic tracks.

## Testing in the browser

1. Open http://localhost:3000/room.
2. Click **Start voice** under the status word (mic permission prompt appears once).
3. Wait for "Listening", then say: **"Order my groceries for the week."**
4. Watch the status move to "Thinking…" while `/api/agent` runs, then GPT-Live should
   speak back what happened. Live captions (Marie / Hearth) appear under the button.
5. Click **End** to close the session cleanly.
6. If GPT-Live can't be reached, use the **"Fallback voice (Realtime)"** link, which
   reveals the original Realtime-API voice control (`gpt-realtime-2.1-mini`) — it uses
   the older tool-calling path via the same `/api/agent` backend indirectly through the
   text fallback, kept working and untouched aside from its model constant.

## Billing note

GPT-Live is billed **per second** of session time, not per token — end sessions promptly
(the "End" button) rather than leaving them open in the background.
