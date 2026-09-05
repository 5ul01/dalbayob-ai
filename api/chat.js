
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const body = req.body || {};

        const message = body.message;
        const history = Array.isArray(body.history)
            ? body.history
            : [];

        /*
         * Optional image supplied by the frontend.
         *
         * This should be a data URL such as:
         *
         * data:image/png;base64,...
         */
        const image = body.image || null;

        if (!message) {
            return res.status(400).json({
                error: "No message provided"
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
You are Dalbayob AI, a modern multimodal conversational AI assistant.

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
- Use the conversation history provided to you.
- Remember relevant information from earlier messages in the current conversation.
- When the user says "that", "it", "the previous one", etc., use the conversation history to understand what they mean.
- If the user corrects you, adapt immediately.
- Do not pretend you remember something that isn't in the conversation history.
- Keep answers concise when the question is simple.
- Give more detail when the user needs it.

Image understanding:
- When an image is provided, carefully analyze what is actually visible.
- Answer questions about objects, people, animals, vehicles, environments, text, screenshots, layouts, colors, and other visible details.
- Do not claim to see something that is not visible.
- If text is visible in an image, read it when possible.
- If the image is unclear or something cannot be determined reliably, say so.
- Treat the image as visual context for the user's current question.
- If the user asks a general question about the uploaded image, describe the relevant parts naturally instead of explaining how image analysis works.

For coding:
- Give complete working code when requested.
- Don't randomly change unrelated parts of the user's project.
- Respect the user's existing technology stack.
- Explain exactly where code should go.
- If something is uncertain, say so instead of inventing an API or feature.

For image generation:
- Understand that the user may want to create an image or modify the latest generated image.
- If the user is asking to modify an existing image, preserve everything that doesn't need changing.
`;

        /*
         * Build conversation.
         */

        const messages = [
            {
                role: "system",
                content: systemPrompt
            }
        ];

        /*
         * Add previous text conversation.
         */

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

        /*
         * Build the current user message.
         *
         * If there is an image, use multimodal content.
         */

        if (image) {
            messages.push({
                role: "user",
                content: [
                    {
                        type: "text",
                        text: message
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
                content: message
            });
        }

        /*
         * Send request to Pollinations.
         */

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
                    messages: messages
                })
            }
        );

        const text =
            await response.text();

        if (!response.ok) {
            console.error(
                "Pollinations error:",
                text
            );

            return res.status(
                response.status
            ).json({
                error: text
            });
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            return res.status(500).json({
                error:
                    "Pollinations returned invalid JSON."
            });
        }

        const reply =
            data.choices?.[0]?.message?.content;

        if (!reply) {
            return res.status(500).json({
                error:
                    "Pollinations returned no reply."
            });
        }

        /*
         * Image generation request.
         */

        if (
            reply.startsWith(
                "[GENERATE_IMAGE]"
            )
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
            reply: reply
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
