```js
import OpenAI from "openai";
import { toFile } from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const {
            prompt,
            image
        } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Missing prompt."
            });
        }

        let result;

        /*
         * NO PREVIOUS IMAGE
         * Generate a completely new image.
         */
        if (!image) {
            result = await client.images.generate({
                model: "gpt-image-2",
                prompt: prompt,
                size: "1024x1024",
                quality: "medium"
            });
        }

        /*
         * PREVIOUS IMAGE EXISTS
         * Edit the existing image instead of starting over.
         */
        else {
            // Remove "data:image/png;base64," etc.
            const base64Data = image.replace(
                /^data:image\/\w+;base64,/,
                ""
            );

            const imageBuffer = Buffer.from(base64Data, "base64");

            const imageFile = await toFile(
                imageBuffer,
                "previous-image.png",
                {
                    type: "image/png"
                }
            );

            result = await client.images.edit({
                model: "gpt-image-2",
                image: imageFile,
                prompt: `
Edit the provided image.

IMPORTANT:
- Make ONLY the changes requested by the user.
- Preserve the existing subject, composition, camera angle,
  background, lighting, proportions and style whenever possible.
- Do not unnecessarily regenerate or redesign unchanged parts.
- If the user requests a small change, keep everything else
  as close to the original as possible.

USER REQUEST:
${prompt}
                `,
                size: "1024x1024",
                quality: "medium"
            });
        }

        const imageBase64 = result.data?.[0]?.b64_json;

        if (!imageBase64) {
            throw new Error("Image API returned no image.");
        }

        return res.status(200).json({
            image: `data:image/png;base64,${imageBase64}`
        });

    } catch (error) {
        console.error("IMAGE ERROR:", error);

        return res.status(500).json({
            error: error?.message || "Image generation failed."
        });
    }
}
```
