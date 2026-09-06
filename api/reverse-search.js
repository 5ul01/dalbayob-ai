export default async function handler(req, res) {
    try {
        if (req.method !== "POST") {
            return res.status(405).json({
                error: "Method not allowed.",
                stage: "method",
                status: 405
            });
        }

        const { image } = req.body || {};

        if (!image) {
            return res.status(400).json({
                error: "No image was provided.",
                stage: "validation",
                status: 400
            });
        }

        let imageUrl = image;

        // --------------------------------------------------
        // HANDLE BASE64 IMAGE
        // --------------------------------------------------

        if (image.startsWith("data:image/")) {
            const match = image.match(
                /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
            );

            if (!match) {
                return res.status(400).json({
                    error: "Invalid image data.",
                    stage: "validation",
                    status: 400
                });
            }

            const mimeType = match[1];
            const base64Data = match[2];

            let buffer;

            try {
                buffer = Buffer.from(base64Data, "base64");
            } catch (error) {
                return res.status(400).json({
                    error: "Could not decode image.",
                    stage: "decode",
                    status: 400,
                    details: error.message
                });
            }

            if (!buffer || buffer.length === 0) {
                return res.status(400).json({
                    error: "Image data is empty.",
                    stage: "decode",
                    status: 400
                });
            }

            const extension =
                mimeType
                    .split("/")
                    .pop()
                    ?.replace("jpeg", "jpg") || "jpg";

            const form = new FormData();

            const blob = new Blob([buffer], {
                type: mimeType
            });

            form.append(
                "file",
                blob,
                `dalbayob-image.${extension}`
            );

            let uploadResponse;

            try {
                uploadResponse = await fetch(
                    "https://tmpfiles.org/api/v1/upload",
                    {
                        method: "POST",
                        body: form
                    }
                );
            } catch (error) {
                return res.status(502).json({
                    error: "Could not connect to image upload service.",
                    stage: "tmpfiles",
                    status: 502,
                    details: error.message
                });
            }

            const uploadText = await uploadResponse.text();

            let uploadData;

            try {
                uploadData = JSON.parse(uploadText);
            } catch {
                return res.status(502).json({
                    error: "Image upload service returned invalid JSON.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadText
                });
            }

            if (!uploadResponse.ok || uploadData.status !== "success") {
                return res.status(502).json({
                    error:
                        uploadData.message ||
                        "Image upload failed.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadData
                });
            }

            if (!uploadData.data?.url) {
                return res.status(502).json({
                    error: "Image upload service did not return a URL.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadData
                });
            }

            imageUrl = uploadData.data.url;

            // Convert tmpfiles page URL to direct download URL
            imageUrl = imageUrl.replace(
                "https://tmpfiles.org/",
                "https://tmpfiles.org/dl/"
            );
        }

        // --------------------------------------------------
        // ALREADY-HOSTED IMAGE
        // --------------------------------------------------

        else if (
            image.startsWith("https://") ||
            image.startsWith("http://")
        ) {
            imageUrl = image;
        }

        else {
            return res.status(400).json({
                error: "Unsupported image format.",
                stage: "validation",
                status: 400
            });
        }

        // --------------------------------------------------
        // QUANTICDATA
        // --------------------------------------------------

        const apiKey = process.env.QD_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "QD_API_KEY is not configured.",
                stage: "configuration",
                status: 500
            });
        }

        let response;

        try {
            response = await fetch(
                "https://api.quanticdata.io/v1/scraper/collectors/google_lens/run",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        image_url: imageUrl,
                        max_results: 20
                    })
                }
            );
        } catch (error) {
            return res.status(502).json({
                error: "Could not connect to QuanticData.",
                stage: "quanticdata",
                status: 502,
                details: error.message
            });
        }

        const responseText = await response.text();

        // --------------------------------------------------
        // QUANTICDATA ERROR
        // --------------------------------------------------

        if (!response.ok) {
            let errorData;

            try {
                errorData = JSON.parse(responseText);
            } catch {
                errorData = responseText;
            }

            return res.status(502).json({
                error:
                    typeof errorData === "object"
                        ? (
                            errorData.message ||
                            errorData.error ||
                            "QuanticData returned an error."
                        )
                        : "QuanticData returned an error.",

                stage: "quanticdata",

                status: response.status,

                details: errorData
            });
        }

        // --------------------------------------------------
        // PARSE SUCCESS RESPONSE
        // --------------------------------------------------

        let data;

        try {
            data = JSON.parse(responseText);
        } catch {
            return res.status(502).json({
                error: "QuanticData returned invalid JSON.",
                stage: "quanticdata",
                status: response.status,
                details: responseText
            });
        }

        /*
         * QuanticData response:
         *
         * {
         *   "status": "done",
         *   "count": 20,
         *   "results": [...]
         * }
         *
         * Some API responses may also use:
         *
         * {
         *   "payload": {
         *      "results": [...]
         *   }
         * }
         */

        const results =
            data.results ||
            data.payload?.results ||
            data.data?.results ||
            [];

        if (!Array.isArray(results)) {
            return res.status(502).json({
                error: "QuanticData returned an unexpected result format.",
                stage: "quanticdata",
                status: response.status,
                details: data
            });
        }

        // --------------------------------------------------
        // NORMALIZE RESULTS
        // --------------------------------------------------

        const normalizedResults = results.map((item, index) => ({
            rank:
                item.rank ??
                index + 1,

            title:
                item.title ??
                "",

            host:
                item.domain ??
                item.host ??
                "",

            source:
                item.source ??
                "",

            pageUrl:
                item.link ??
                item.page_url ??
                item.url ??
                "",

            imageUrl:
                item.image ??
                item.image_url ??
                "",

            thumbnail:
                item.thumbnail ??
                "",

            date:
                item.date ??
                "",

            size:
                item.size ??
                "",

            exactMatch:
                item.exact_match ??
                false
        }));

        // --------------------------------------------------
        // SUCCESS
        // --------------------------------------------------

        return res.status(200).json({
            success: true,
            imageUrl,
            count: normalizedResults.length,
            results: normalizedResults
        });

    } catch (error) {
        console.error(
            "REVERSE IMAGE SEARCH ERROR:",
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                "Internal server error.",

            stage: "backend",

            status: 500,

            details: {
                name: error?.name || "UnknownError",
                stack: error?.stack || null
            }
        });
    }
}
