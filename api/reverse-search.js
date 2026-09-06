export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed."
        });
    }

    const apiKey = process.env.QD_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "QD_API_KEY is not configured in Vercel."
        });
    }

    try {
        const { image } = req.body || {};

        if (!image || typeof image !== "string") {
            return res.status(400).json({
                error: "No image was provided."
            });
        }

        if (!image.startsWith("data:image/")) {
            return res.status(400).json({
                error: "Invalid image format."
            });
        }

        /*
         * Extract MIME type and base64 data
         */

        const match = image.match(
            /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
        );

        if (!match) {
            return res.status(400).json({
                error: "Invalid base64 image."
            });
        }

        const mimeType = match[1];
        const base64Data = match[2];

        const imageBuffer = Buffer.from(
            base64Data,
            "base64"
        );

        /*
         * Prevent ridiculously large uploads.
         * 15 MB is more than enough for normal images.
         */

        const MAX_SIZE = 15 * 1024 * 1024;

        if (imageBuffer.length > MAX_SIZE) {
            return res.status(413).json({
                error: "Image is too large. Maximum size is 15 MB."
            });
        }

        /*
         * Determine a filename.
         */

        let extension = "jpg";

        if (mimeType === "image/png") {
            extension = "png";
        } else if (mimeType === "image/webp") {
            extension = "webp";
        } else if (mimeType === "image/gif") {
            extension = "gif";
        } else if (mimeType === "image/jpeg") {
            extension = "jpg";
        }

        /*
         * ----------------------------------------------------
         * TEMPORARILY UPLOAD IMAGE
         * ----------------------------------------------------
         *
         * Google Lens needs a publicly accessible URL.
         */

        const formData = new FormData();

        const blob = new Blob(
            [imageBuffer],
            {
                type: mimeType
            }
        );

        formData.append(
            "file",
            blob,
            `dalbayob-reverse.${extension}`
        );

        const uploadResponse = await fetch(
            "https://tmpfiles.org/api/v1/upload",
            {
                method: "POST",
                body: formData
            }
        );

        const uploadText =
            await uploadResponse.text();

        let uploadData;

        try {
            uploadData =
                JSON.parse(uploadText);
        } catch {
            throw new Error(
                "Temporary image upload returned invalid data."
            );
        }

        if (
            !uploadResponse.ok ||
            uploadData.status !== "success" ||
            !uploadData.data?.url
        ) {
            console.error(
                "tmpfiles error:",
                uploadData
            );

            throw new Error(
                "Could not temporarily upload the image."
            );
        }

        /*
         * tmpfiles returns something like:
         *
         * https://tmpfiles.org/1234567/image.jpg
         *
         * Convert it to the direct downloadable URL:
         *
         * https://tmpfiles.org/dl/1234567/image.jpg
         */

        const uploadedUrl =
            uploadData.data.url;

        let publicImageUrl =
            uploadedUrl.replace(
                "https://tmpfiles.org/",
                "https://tmpfiles.org/dl/"
            );

        /*
         * ----------------------------------------------------
         * GOOGLE LENS
         * ----------------------------------------------------
         */

        const lensResponse = await fetch(
            "https://api.quanticdata.io/v1/scraper/collectors/google_lens/run",
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    image_url:
                        publicImageUrl,

                    max_results: 20,

                    lang: "en"
                })
            }
        );

        const lensText =
            await lensResponse.text();

        let lensData;

        try {
            lensData =
                JSON.parse(lensText);
        } catch {
            console.error(
                "QuanticData raw response:",
                lensText
            );

            throw new Error(
                "Google Lens API returned invalid data."
            );
        }

        if (!lensResponse.ok) {

            console.error(
                "QuanticData error:",
                lensData
            );

            const apiError =
                lensData?.message ||
                lensData?.error ||
                lensData?.payload?.message ||
                "Google Lens search failed.";

            throw new Error(apiError);
        }

        /*
         * QuanticData has used both an envelope-style response
         * and payload.results in its API documentation.
         * Support both so the frontend doesn't break if the
         * response format differs.
         */

        const rawResults =
            lensData?.payload?.results ||
            lensData?.results ||
            [];


        /*
         * Normalize the results for Dalbayob AI.
         */

        const results =
            rawResults
                .map((result) => {

                    const pageUrl =
                        result.link ||
                        result.url ||
                        "";

                    const imageUrl =
                        result.image ||
                        result.thumbnail ||
                        "";

                    const title =
                        result.title ||
                        "Untitled result";

                    const host =
                        result.domain ||
                        result.source ||
                        "";

                    return {
                        rank:
                            result.rank ||
                            null,

                        title,

                        host,

                        source:
                            result.source ||
                            "",

                        pageUrl,

                        imageUrl,

                        thumbnail:
                            result.thumbnail ||
                            "",

                        date:
                            result.date ||
                            null,

                        size:
                            result.size ||
                            null,

                        exactMatch:
                            Boolean(
                                result.exact_match
                            )
                    };

                })
                .filter(result => {

                    return (
                        result.pageUrl ||
                        result.imageUrl ||
                        result.title
                    );

                });


        return res.status(200).json({

            success: true,

            results,

            count:
                results.length,

            cost:
                lensData?.cost ??
                lensData?.payload?.cost ??
                lensData?.usage?.cost_usd ??
                null

        });


    } catch (error) {

        console.error(
            "Reverse image search error:",
            error
        );

        return res.status(500).json({

            error:
                error?.message ||
                "Reverse image search failed."

        });

    }
}
