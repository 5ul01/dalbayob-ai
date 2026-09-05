```js
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const message = req.body?.message;

    if (!message) {
        return res.status(400).json({
            error: "No message provided"
        });
    }

    const key = process.env.POLLINATIONS_API_KEY;

    if (!key) {
        return res.status(500).json({
            error: "POLLINATIONS_API_KEY is missing."
        });
    }

    try {
        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + key
                },

                body: JSON.stringify({
                    model: "openai",
                    messages: [
                        {
                            role: "system",
                            content: "You are Dalbayob AI. Be helpful, friendly and conversational."
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

        console.log("Pollinations status:", response.status);
        console.log("Pollinations response:", text);

        if (!response.ok) {
            return res.status(response.status).json({
                error: text
            });
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(500).json({
                error: "Pollinations returned non-JSON data."
            });
        }

        const reply = data.choices?.[0]?.message?.content;

        if (!reply) {
            return res.status(500).json({
                error: "No reply received from Pollinations."
            });
        }

        return res.status(200).json({
            reply: reply
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: error.message || "Chat request failed."
        });
    }
}
```
