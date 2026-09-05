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
You are Dalbayob AI.

You are a helpful conversational AI.

IMPORTANT:
You are connected to an image generation system.

When the user asks you to create, generate, draw, make, or produce an image, respond with EXACTLY:

[GENERATE_IMAGE]
followed by a detailed image prompt.

Example:

User: Make a picture of a fox wearing a black hoodie

Assistant:
[GENERATE_IMAGE]
A detailed digital illustration of an anthropomorphic fox wearing a black hoodie...

For normal questions, DO NOT use [GENERATE_IMAGE].
Just respond normally.

Never say that you cannot generate images.
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
        } catch (error) {
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

            const imageUrl =
                "https://image.pollinations.ai/prompt/" +
                encodeURIComponent(imagePrompt);

            return res.status(200).json({
                type: "image",
                reply: "🎨 Generating your image...",
                prompt: imagePrompt,
                image: imageUrl
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
