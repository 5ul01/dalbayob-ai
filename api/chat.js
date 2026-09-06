export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const body = req.body || {};

        const message =
            typeof body.message === "string"
                ? body.message.trim()
                : "";

        const history =
            Array.isArray(body.history)
                ? body.history
                : [];

        const image =
            typeof body.image === "string" &&
            body.image.startsWith("data:image/")
                ? body.image
                : null;

        if (!message && !image) {
            return res.status(400).json({
                error: "No message or image provided."
            });
        }

        const apiKey =
            process.env.POLLINATIONS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error:
                    "POLLINATIONS_API_KEY is missing in Vercel."
            });
        }

        const systemPrompt = `
You are Dalbayob AI, a modern multimodal AI assistant.

PERSONALITY:
- Natural, intelligent and conversational.
- Understand slang, shorthand, typos and casual language.
- Match the user's tone.
- Don't sound like corporate customer support.
- Don't unnecessarily repeat the user's question.
- Keep simple answers concise.
- Give more detail when useful.
- Use humor when appropriate.
- Don't pretend to be human.
- Be honest when uncertain.

CONVERSATION:
- Use the supplied conversation history.
- Resolve references such as "that", "it", "this one", etc.
- Adapt immediately when the user corrects you.
- Never invent memories that aren't present in the supplied conversation.

IMAGE UNDERSTANDING:
- Carefully inspect the supplied image.
- Describe only what is actually visible.
- Read visible text when possible.
- Identify objects, vehicles, people, animals, locations, logos,
  interfaces, screenshots, artwork and other visible elements.
- If something cannot be determined reliably, say so.
- Never claim certainty where the image does not support it.

IMPORTANT:
- You are NOT a reverse-image-search engine.
- If the user asks to reverse-search an image, explain that
  Dalbayob's dedicated reverse-search feature should be used.
- Do not invent websites or image matches.

CODING:
- When asked for code, provide complete working code.
- Respect the user's existing project and technology stack.
- Don't change unrelated parts of the project.
`;

        const messages = [
            {
                role: "system",
                content: systemPrompt
            }
        ];

        for (const item of history) {
            if (
                item &&
                (item.role === "user" ||
                    item.role === "assistant") &&
                typeof item.content === "string" &&
                item.content.trim()
            ) {
                messages.push({
                    role: item.role,
                    content: item.content
                });
            }
        }

        const currentText =
            message ||
            "Analyze this image carefully and describe what you can reliably determine.";

        if (image) {
            messages.push({
                role: "user",
                content: [
                    {
                        type: "text",
                        text: currentText
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: image
                        }
                    }
                ]
            });
        } else {
            messages.push({
                role: "user",
                content: currentText
            });
        }

        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "Authorization":
                        "Bearer " + apiKey
                },

                body: JSON.stringify({
                    model: "gpt-5.6-luna",
                    messages
                })
            }
        );

        const rawText =
            await response.text();

        if (!response.ok) {
            console.error(
                "Pollinations error:",
                rawText
            );

            return res.status(
                response.status
            ).json({
                error:
                    "AI request failed: " +
                    rawText
            });
        }

        let data;

        try {
            data = JSON.parse(rawText);
        } catch {
            return res.status(500).json({
                error:
                    "Pollinations returned invalid JSON."
            });
        }

        const reply =
            data?.choices?.[0]?.message?.content;

        if (!reply) {
            return res.status(500).json({
                error:
                    "The AI returned no response."
            });
        }

        if (
            typeof reply === "string" &&
            reply.startsWith("[GENERATE_IMAGE]")
        ) {
            const imagePrompt =
                reply
                    .replace(
                        "[GENERATE_IMAGE]",
                        ""
                    )
                    .trim();

            return res.status(200).json({
                type: "image",
                reply:
                    "🎨 Generating image...",
                prompt:
                    imagePrompt
            });
        }

        return res.status(200).json({
            type: "text",
            reply
        });

    } catch (error) {
        console.error(
            "Chat error:",
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                "Chat request failed."
        });
    }
}
