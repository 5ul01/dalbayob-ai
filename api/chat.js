```js
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                error: "No message provided"
            });
        }

        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.POLLINATIONS_API_KEY}`
                },

                body: JSON.stringify({
                    model: "openai",

                    messages: [
                        {
                            role: "system",
                            content: "You are Dalbayob AI. Be helpful, conversational, and concise. Answer the user's questions naturally."
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Pollinations error:", data);

            return res.status(response.status).json({
                error:
                    data.error?.message ||
                    data.error ||
                    "Pollinations request failed"
            });
        }

        const reply = data.choices?.[0]?.message?.content;

        if (!reply) {
            console.error("Unexpected response:", data);

            return res.status(500).json({
                error: "AI returned an empty response"
            });
        }

        return res.status(200).json({
            reply: reply
        });

    } catch (error) {
        console.error("Chat error:", error);

        return res.status(500).json({
            error: "Something went wrong connecting to Pollinations."
        });
    }
}
```
