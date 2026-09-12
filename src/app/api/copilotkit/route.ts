import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

const runtime = new CopilotRuntime();

function buildAdapter() {
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const openai = new OpenAI({
    apiKey: hasOpenAIKey ? process.env.OPENAI_API_KEY : process.env.OPENROUTER_API_KEY,
    baseURL: hasOpenAIKey ? undefined : "https://openrouter.ai/api/v1",
  });
  return new OpenAIAdapter({ openai, model: process.env.OPENAI_AGENT_MODEL || "gpt-4o-mini" });
}

export async function POST(req: NextRequest) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: buildAdapter(),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
}
