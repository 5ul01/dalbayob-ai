export default async function handler(
    req,
    res
) {

    if (req.method !== "POST") {

        return res.status(405).json({
            error: "Method not allowed."
        });

    }


    try {

        const body =
            req.body || {};


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
                error:
                    "No message or image provided."
            });

        }


        const apiKey =
            process.env.POLLINATIONS_API_KEY;


        if (!apiKey) {

            return res.status(500).json({
                error:
                    "POLLINATIONS_API_KEY is not configured."
            });

        }


        const systemPrompt = `
You are Dalbayob AI.

You are a multimodal AI assistant.

PERSONALITY:

- Natural.
- Intelligent.
- Conversational.
- Understand slang and casual language.
- Match the user's tone.
- Do not sound like corporate customer support.
- Do not unnecessarily repeat questions.
- Keep simple answers concise.
- Give detail when useful.
- Be honest when uncertain.

IMAGE UNDERSTANDING:

When an image is supplied:

- Inspect it carefully.
- Identify visible objects.
- Read visible text when possible.
- Identify logos and brands when reasonably clear.
- Identify vehicles and models when possible.
- Identify locations when evidence supports it.
- Describe artwork and screenshots accurately.
- Separate observations from guesses.
- Never invent details that are not visible.

REVERSE IMAGE SEARCH:

You are not the reverse-image-search engine.

The application has a separate reverse-search feature.

If the user asks for an exact source or internet match,
do not pretend that visual analysis itself proves the source.

CODING:

When asked for code:

- Provide complete code when practical.
- Preserve the user's existing architecture.
- Do not unnecessarily replace unrelated code.
- Explain important setup requirements.

GENERAL:

Be useful.
Be direct.
Do not claim to have searched the internet unless
the application actually provided search results.
`;


        const messages = [

            {
                role: "system",
                content:
                    systemPrompt
            }

        ];


        /*
         * Keep the most recent conversation
         * context without allowing gigantic
         * histories to grow forever.
         */

        const recentHistory =
            history.slice(-20);


        for (
            const item of recentHistory
        ) {

            if (
                !item ||
                (
                    item.role !== "user" &&
                    item.role !== "assistant"
                ) ||
                typeof item.content !== "string"
            ) {
                continue;
            }


            messages.push({

                role:
                    item.role,

                content:
                    item.content

            });

        }


        const userText =
            message ||
            "Analyze this image carefully and tell me what you can determine.";


        /*
         * Multimodal request.
         */

        if (image) {

            messages.push({

                role: "user",

                content: [

                    {
                        type: "text",

                        text:
                            userText

                    },

                    {
                        type: "image_url",

                        image_url: {

                            url:
                                image

                        }

                    }

                ]

            });

        } else {

            messages.push({

                role: "user",

                content:
                    userText

            });

        }


        const response =
            await fetch(
                "https://gen.pollinations.ai/v1/chat/completions",
                {

                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${apiKey}`

                    },

                    body: JSON.stringify({

                        model:
                            "gpt-5.6-luna",

                        messages

                    })

                }
            );


        const raw =
            await response.text();


        if (!response.ok) {

            console.error(
                "Pollinations error:",
                raw
            );


            return res.status(
                response.status
            ).json({

                error:
                    "AI request failed."

            });

        }


        let data;


        try {

            data =
                JSON.parse(raw);

        } catch {

            return res.status(502).json({

                error:
                    "AI returned invalid JSON."

            });

        }


        const reply =
            data?.choices?.[0]?.message?.content;


        if (!reply) {

            return res.status(502).json({

                error:
                    "The AI returned no response."

            });

        }


        return res.status(200).json({

            type:
                "text",

            reply:
                String(reply)

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
