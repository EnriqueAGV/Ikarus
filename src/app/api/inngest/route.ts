import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// An agent reply can take several LLM calls; give it Vercel's full window.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
