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

        return res.status(200).json({
            reply: reply
        });

    } catch (error) {
        console.error("Chat error:", error);

        return res.status(500).json({
            error: error.message
        });
    }
}
