```js
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { message } = req.body || {};

        if (!message) {
            return res.status(400).json({
                error: "No message provided"
            });
        }

        const apiKey = process.env.POLLINATIONS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "POLLINATIONS_API_KEY is not configured in Vercel."
            });
        }

        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },

                body: JSON.stringify({
                    model: "openai",
                    messages: [
                        {
                            role: "system",
                            content: "You are Dalbayob AI. Be helpful, conversational and concise."
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ]
                })
            }
        );

        const contentType =
            response.headers.get("content-type") || "";

        const raw = await response.text();

        console.log("Pollinations status:", response.status);
        console.log("Pollinations content-type:", contentType);
        console.log("Pollinations response:", raw);

        if (!response.ok) {
            let errorMessage = raw;

            if (contentType.includes("application/json")) {
                try {
                    const errorData = JSON.parse(raw);

                    errorMessage =
                        errorData?.error?.message ||
                        errorData?.error ||
                        raw;
                } catch {
                    // Keep raw response
                }
            }

            return res.status(response.status).json({
                error: errorMessage || "Pollinations request failed"
            });
        }

        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            console.error(
                "Pollinations returned non-JSON:",
                raw
            );

            return res.status(502).json({
                error:
                    "Pollinations returned an unexpected response."
            });
        }

        const reply =
            data?.choices?.[0]?.message?.content;

        if (!reply) {
            console.error(
                "Unexpected Pollinations data:",
                data
            );

            return res.status(500).json({
                error: "Pollinations returned no AI response."
            });
        }

        return res.status(200).json({
            reply
        });

    } catch (error) {
        console.error("Chat error:", error);

        return res.status(500).json({
            error:
                error?.message ||
                "Something went wrong connecting to Pollinations."
        });
    }
}
```
