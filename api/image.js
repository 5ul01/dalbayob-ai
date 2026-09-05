export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { prompt, image } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Missing prompt."
            });
        }

        const apiKey = process.env.POLLINATIONS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "POLLINATIONS_API_KEY is not configured in Vercel."
            });
        }

        let response;

        /*
         * =====================================================
         * NEW IMAGE
         * =====================================================
         */

        if (!image) {

            response = await fetch(
                "https://gen.pollinations.ai/v1/images/generations",
                {
                    method: "POST",

                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        model: "gpt-image-2",

                        prompt: prompt,

                        size: "1024x1024"
                    })
                }
            );
        }

        /*
         * =====================================================
         * EDIT EXISTING IMAGE
         * =====================================================
         */

        else {

            /*
             * Convert the data URL from the browser
             * into a Blob that Pollinations can receive.
             */

            const base64Data =
                image.replace(
                    /^data:image\/\w+;base64,/,
                    ""
                );

            const imageBuffer =
                Buffer.from(
                    base64Data,
                    "base64"
                );


            const form =
                new FormData();


            /*
             * Add the previous image.
             */

            form.append(
                "image",
                new Blob(
                    [imageBuffer],
                    {
                        type: "image/png"
                    }
                ),
                "previous-image.png"
            );


            /*
             * Tell the image model exactly what
             * needs to change.
             */

            form.append(
                "prompt",
                `
Edit the provided image.

Make ONLY the changes requested below.

Preserve everything else:
- subject
- identity
- pose
- composition
- camera angle
- background
- lighting
- colors
- art style
- proportions

Do not redesign the image.

USER REQUEST:
${prompt}
                `.trim()
            );


            /*
             * Image editing model.
             */

            form.append(
                "model",
                "gpt-image-2"
            );


            response =
                await fetch(
                    "https://gen.pollinations.ai/v1/images/edits",
                    {
                        method: "POST",

                        headers: {
                            "Authorization":
                                `Bearer ${apiKey}`
                        },

                        body: form
                    }
                );
        }


        /*
         * =====================================================
         * HANDLE API RESPONSE
         * =====================================================
         */

        const data =
            await response.json();


        if (!response.ok) {

            console.error(
                "Pollinations error:",
                data
            );

            throw new Error(
                data?.error?.message ||
                data?.error ||
                "Pollinations image request failed."
            );
        }


        /*
         * Pollinations returns b64_json
         * for the OpenAI-compatible image endpoints.
         */

        const imageBase64 =
            data?.data?.[0]?.b64_json;


        if (!imageBase64) {

            console.error(
                "Unexpected Pollinations response:",
                data
            );

            throw new Error(
                "Pollinations returned no image."
            );
        }


        /*
         * Send the image back to the browser.
         */

        return res.status(200).json({

            image:
                `data:image/png;base64,${imageBase64}`

        });


    } catch (error) {

        console.error(
            "POLLINATIONS IMAGE ERROR:",
            error
        );

        return res.status(500).json({

            error:
                error?.message ||
                "Image generation failed."

        });
    }
}
