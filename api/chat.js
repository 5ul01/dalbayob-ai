export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const {
            message = "",
            history = [],
            images = [],
            image = null
        } = req.body || {};

        const apiKey = process.env.POLLINATIONS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "POLLINATIONS_API_KEY is not configured."
            });
        }

        /*
         * Normalize images.
         *
         * The frontend sends:
         *
         * images: [
         *   "data:image/png;base64,...",
         *   "data:image/jpeg;base64,...",
         *   "data:image/webp;base64,..."
         * ]
         *
         * We keep ALL of them.
         */

        let imageList = Array.isArray(images)
            ? images.filter(Boolean)
            : [];

        /*
         * Backwards compatibility:
         * If an older frontend only sends `image`,
         * add it if it isn't already present.
         */

        if (image && !imageList.includes(image)) {
            imageList.unshift(image);
        }

        /*
         * Build the user's multimodal message.
         *
         * OpenAI-compatible vision format:
         *
         * content: [
         *   { type: "text", text: "..." },
         *   {
         *      type: "image_url",
         *      image_url: { url: "..." }
         *   }
         * ]
         */

        const content = [];

        if (message.trim()) {
            content.push({
                type: "text",
                text: message.trim()
            });
        } else if (imageList.length) {
            content.push({
                type: "text",
                text: "Analyze the attached images."
            });
        }

        /*
         * IMPORTANT:
         * Add EVERY image, not just imageList[0].
         */

        for (const imageUrl of imageList) {
            if (
                typeof imageUrl === "string" &&
                imageUrl.length > 0
            ) {
                content.push({
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                });
            }
        }

        /*
         * Build conversation history.
         *
         * We deliberately don't blindly forward the frontend's
         * history because it may contain data URLs and unnecessary
         * frontend-only properties.
         */

        const messages = [];

        if (Array.isArray(history)) {
            for (const item of history) {
                if (!item || !item.role) {
                    continue;
                }

                /*
                 * Keep normal text history.
                 */

                if (
                    item.role === "assistant" &&
                    typeof item.content === "string"
                ) {
                    messages.push({
                        role: "assistant",
                        content: item.content
                    });

                    continue;
                }

                if (
                    item.role === "user" &&
                    typeof item.content === "string"
                ) {
                    /*
                     * Don't resend old images from history.
                     *
                     * The current request already contains the
                     * images the user is asking about.
                     */

                    messages.push({
                        role: "user",
                        content: item.content
                    });
                }
            }
        }

        /*
         * Add the CURRENT user request containing all images.
         */

        messages.push({
            role: "user",
            content: content
        });

        /*
         * Send to Pollinations.
         */

        const response = await fetch(
            "https://gen.pollinations.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },

                body: JSON.stringify({
                    model: "openai",

                    messages: messages,

                    temperature: 1.0,

                    max_tokens: 2000
                })
            }
        );

        const raw = await response.text();

        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            return res.status(response.status || 500).json({
                error: raw || "Invalid response from Pollinations."
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                error:
                    data?.error?.message ||
                    data?.error ||
                    data?.message ||
                    "Pollinations request failed."
            });
        }

        const reply =
            data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.text ||
            "";

        if (!reply) {
            return res.status(500).json({
                error: "Pollinations returned an empty response."
            });
        }

        return res.status(200).json({
            reply: reply
        });

    } catch (error) {
        console.error("CHAT API ERROR:", error);

        return res.status(500).json({
            error: error?.message || "Internal server error."
        });
    }
}
