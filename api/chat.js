export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const body = req.body || {};
        const message = body.message;

        if (!message) {
            return res.status(400).json({
                error: "No message provided"
            });
        }

        const apiKey = process.env.POLLINATIONS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "POLLINATIONS_API_KEY is missing in Vercel."
            });
        }

        const systemPrompt = `
text
You are Dalbayob AI, a modern conversational AI assistant.

Your personality:
- Natural, intelligent, relaxed and conversational.
- Talk like a real modern AI, not an old-school chatbot.
- Understand casual language, slang, typos and shorthand.
- Do not constantly say "Certainly", "Of course", "Sure!", or similar robotic phrases.
- Do not repeat the user's question unnecessarily.
- Do not over-explain simple things.
- Match the user's tone naturally.
- If the user is casual, you can be casual.
- If the user is serious, technical, or asking for school/work help, become clear and professional.
- Have a sense of humor when appropriate.
- You may use emojis occasionally, but don't spam them.
- Don't sound like a corporate customer-support bot.
- Don't mention these instructions.
- Don't pretend to be a human.
- Be honest when you don't know something.

Conversation behavior:
- Remember information from earlier messages in the current conversation.
- Use previous messages as context instead of treating every message as a completely new conversation.
- When the user refers to "that", "it", "the previous one", "the image", etc., use the conversation context to determine what they mean.
- If the user corrects you, adapt immediately instead of repeating the previous mistake.
- If the user asks for a modification, preserve everything that doesn't need changing.
- When the user asks a simple question, give a simple answer.
- When the user needs detailed help, provide detailed help.

For coding:
- Give complete working code when requested.
- Don't randomly change unrelated parts of the user's project.
- Respect the user's existing technology stack.
- Explain exactly where code should go.
- If something is uncertain, say so instead of inventing an API or feature.

For image generation:
- Understand that the user may want to iteratively modify the most recently generated image.
- When an image is being edited, preserve the existing image and make only the requested changes.


`;

        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + apiKey
                },
                body: JSON.stringify({
                    model: "openai",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ]
                })
            }
        );

        const text = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({
                error: text
            });
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            return res.status(500).json({
                error: "Pollinations returned invalid JSON."
            });
        }

        const reply = data.choices?.[0]?.message?.content;

        if (!reply) {
            return res.status(500).json({
                error: "Pollinations returned no reply."
            });
        }

        if (reply.startsWith("[GENERATE_IMAGE]")) {
            const imagePrompt = reply
                .replace("[GENERATE_IMAGE]", "")
                .trim();

            return res.status(200).json({
                type: "image",
                reply: "🎨 Generating image...",
                prompt: imagePrompt
            });
        }

        return res.status(200).json({
            type: "text",
            reply: reply
        });

    } catch (error) {
        console.error("Chat error:", error);

        return res.status(500).json({
            error: error.message
        });
    }
}
