import type OpenAI from "openai";
import { z } from "zod";
import { getOpenAI } from "@/integrations/openai";
import { findPharmacy } from "@/integrations/exa";
import { ToolArgs, type ToolName } from "@/contracts";
import { buildBasket, buildUsualBasket, getBasket, getBudget, createApproval, logActivity } from "@/domain";
import { checkout } from "@/server/checkout";
import { sendApprovalRequest } from "@/integrations/telegram";

const SYSTEM_PROMPT = `You are Hearth, a warm home companion for an elderly person.
Speak in short, simple sentences. Be patient: if the same question is asked
many times, answer the 40th time exactly as kindly as the first. Never
diagnose medical conditions or symptoms — suggest calling a doctor or family
member instead. Use your tools to check on groceries, refills, and pharmacies.
You can see Marie through the room camera, always. When a photo is attached it
is the camera's view right now; a "Camera scene" line is the latest description.
The person in view is Marie — you never need to identify anyone, just describe
what is visible: where she is, what she's doing, what she's wearing. NEVER say
you cannot see, cannot recognize people, or have no camera; if the frame is
empty or dark, say what you do see (an empty room, a dark room). Never diagnose.`;

const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "build_basket",
      description: "Build a shopping basket from a list of item names and quantities.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                qty: { type: "integer", minimum: 1 },
              },
              required: ["name", "qty"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_approval",
      description: "Ask the family approver to approve a basket that is over budget.",
      parameters: {
        type: "object",
        properties: { basketId: { type: "string" } },
        required: ["basketId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkout",
      description: "Attempt to pay for a basket. May require approval if over budget.",
      parameters: {
        type: "object",
        properties: {
          basketId: { type: "string" },
          approvalId: { type: ["string", "null"] },
        },
        required: ["basketId", "approvalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_refill",
      description: "Request a medication refill.",
      parameters: {
        type: "object",
        properties: { medication: { type: "string" } },
        required: ["medication"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_pharmacy",
      description: "Find the nearest open pharmacy.",
      parameters: {
        type: "object",
        properties: { near: { type: "string" } },
        required: ["near"],
      },
    },
  },
];

type ToolCallRecord = { name: string; args: unknown; result: unknown };

async function runTool(elderId: string, name: ToolName, rawArgs: unknown): Promise<unknown> {
  const schema = ToolArgs[name];
  const args = schema.parse(rawArgs);

  switch (name) {
    case "build_basket": {
      const a = args as z.infer<(typeof ToolArgs)["build_basket"]>;
      const basket = await buildBasket(elderId, a.items);
      await logActivity(elderId, "basket_built", "Put together your basket.", basket.id);
      return basket;
    }
    case "request_approval": {
      const a = args as z.infer<(typeof ToolArgs)["request_approval"]>;
      const basket = await getBasket(a.basketId);
      if (!basket) throw new Error(`Basket not found: ${a.basketId}`);
      const budget = await getBudget(basket.elderId);
      const approval = await createApproval(basket, 15);
      await logActivity(basket.elderId, "approval_requested", "Asked Claire to approve this order.", approval.id);
      try {
        await sendApprovalRequest(approval, basket, budget.approverChatId);
      } catch (err) {
        console.warn("Failed to send Telegram approval request", err);
      }
      return approval;
    }
    case "checkout": {
      const a = args as z.infer<(typeof ToolArgs)["checkout"]>;
      return await checkout(a.basketId, a.approvalId);
    }
    case "check_in":
    case "alert_family": {
      return { ok: true };
    }
    case "request_refill": {
      const a = args as z.infer<(typeof ToolArgs)["request_refill"]>;
      await logActivity(elderId, "refill_requested", `Asked the pharmacy to refill ${a.medication}.`);
      return { medication: a.medication, status: "requested" };
    }
    case "find_pharmacy": {
      const a = args as z.infer<(typeof ToolArgs)["find_pharmacy"]>;
      return await findPharmacy(a.near);
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown tool: ${_exhaustive}`);
    }
  }
}

export async function runAgent(
  elderId: string,
  text: string,
  imageBase64?: string,
  scene?: string
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  const model = process.env.OPENAI_AGENT_MODEL ?? "gpt-4o-mini";
  const userContent: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] = imageBase64
    ? [
        { type: "text", text },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "low" },
        },
      ]
    : text;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\nToday is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.` },
    ...(scene ? [{ role: "system" as const, content: `Camera scene right now: ${scene}` }] : []),
    { role: "user", content: userContent },
  ];
  const toolCalls: ToolCallRecord[] = [];

  await logActivity(elderId, "utterance", text);

  if (/order.*(groceries|usual)/i.test(text)) {
    const basket = await buildUsualBasket(elderId);
    await logActivity(elderId, "basket_built", "Put together your usual basket.", basket.id);
    const result = await checkout(basket.id, null);
    toolCalls.push({ name: "checkout", args: { basketId: basket.id, approvalId: null }, result });

    const reply =
      !result.ok && result.reason === "approval_required"
        ? "I've put your order together and asked Claire to approve it since it's a bit over budget."
        : result.ok
          ? "All set — your groceries are on their way."
          : "I ran into a problem placing that order. Let's try again in a bit.";

    await logActivity(elderId, "companion_said", reply);
    return { reply, toolCalls };
  }

  for (let i = 0; i < 6; i++) {
    const completion = await getOpenAI().chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
    });

    const choice = completion.choices[0];
    const message = choice.message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = message.content ?? "";
      await logActivity(elderId, "companion_said", reply);
      return { reply, toolCalls };
    }

    messages.push(message);

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const name = call.function.name as ToolName;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }

      let result: unknown;
      try {
        result = await runTool(elderId, name, parsedArgs);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      toolCalls.push({ name, args: parsedArgs, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  const fallback = "I'm having trouble finishing that right now, but I'm still here with you.";
  await logActivity(elderId, "companion_said", fallback);
  return { reply: fallback, toolCalls };
}
