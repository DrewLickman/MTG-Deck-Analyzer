import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request) {
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ skipped: true });
  }

  const { prompt } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json(
      { error: { message: "Request body must include a prompt string." } },
      { status: 400 }
    );
  }

  const apiUrl = process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.AI_MODEL || "gpt-4.1-mini";

  const remoteResponse = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await remoteResponse.json();

  if (!remoteResponse.ok) {
    return NextResponse.json(data, { status: remoteResponse.status });
  }

  const text =
    data.choices?.[0]?.message?.content ||
    data.output_text ||
    data.output?.flatMap(item => item.content || [])
      .map(item => item.text || "")
      .join("") ||
    "";

  return NextResponse.json({ content: [{ type: "text", text }] });
}
