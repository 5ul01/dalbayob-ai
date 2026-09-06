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

        /*
         * If the frontend sends a base64 data URL,
         * upload it to tmpfiles first.
         */
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
            } catch (err) {
                return res.status(400).json({
                    error: "Could not decode image.",
                    stage: "decode",
                    status: 400,
                    details: err.message
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
                mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";

            /*
             * Native Web FormData.
             * This works with Vercel's native fetch.
             */
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
            } catch (err) {
                return res.status(502).json({
                    error: "Could not connect to temporary image upload service.",
                    stage: "tmpfiles",
                    status: 502,
                    details: err.message
                });
            }

            const uploadText = await uploadResponse.text();

            let uploadData;

            try {
                uploadData = JSON.parse(uploadText);
            } catch {
                return res.status(502).json({
                    error: "Temporary image upload service returned invalid JSON.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadText
                });
            }

            if (!uploadResponse.ok || uploadData.status !== "success") {
                return res.status(502).json({
                    error:
                        uploadData.message ||
                        "Temporary image upload failed.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadData
                });
            }

            if (!uploadData.data?.url) {
                return res.status(502).json({
                    error: "Temporary image service did not return an image URL.",
                    stage: "tmpfiles",
                    status: uploadResponse.status,
                    details: uploadData
                });
            }

            imageUrl = uploadData.data.url;

            /*
             * tmpfiles returns:
             * https://tmpfiles.org/123456/image.png
             *
             * Google Lens needs the direct file URL:
             * https://tmpfiles.org/dl/123456/image.png
             */
            imageUrl = imageUrl.replace(
                "https://tmpfiles.org/",
                "https://tmpfiles.org/dl/"
            );
        }

        /*
         * If the image is already hosted online,
         * don't upload it again.
         */
        else if (
            image.startsWith("http://") ||
            image.startsWith("https://")
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

        const apiKey = process.env.QD_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "QD_API_KEY is not configured in Vercel.",
                stage: "configuration",
                status: 500
            });
        }

        /*
         * Start Google Lens reverse image search.
         */
        let lensResponse;

        try {
            lensResponse = await fetch(
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
        } catch (err) {
            return res.status(502).json({
                error: "Could not connect to reverse image search API.",
                stage: "quanticdata",
                status: 502,
                details: err.message
            });
        }

        const lensText = await lensResponse.text();

        let lensData;

        try {
            lensData = JSON.parse(lensText);
        } catch {
            return res.status(502).json({
                error: "Reverse image search API returned invalid JSON.",
                stage: "quanticdata",
                status: lensResponse.status,
                details: lensText
            });
        }

        if (!lensResponse.ok) {
            return res.status(lensResponse.status).json({
                error:
                    lensData.message ||
                    lensData.error ||
                    "Reverse image search API request failed.",
                stage: "quanticdata",
                status: lensResponse.status,
                details: lensData
            });
        }

        /*
         * Some QuanticData requests may return 202
         * and require polling.
         */
        let finalData = lensData;

        const runId =
            lensData.run_id ||
            lensData.id ||
            lensData.data?.run_id ||
            lensData.data?.id;

        if (
            lensResponse.status === 202 &&
            runId
        ) {
            const maxAttempts = 20;
            const delay = 1500;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(resolve =>
                    setTimeout(resolve, delay)
                );

                let pollResponse;

                try {
                    pollResponse = await fetch(
                        `https://api.quanticdata.io/v1/scraper/collectors/runs/${encodeURIComponent(runId)}`,
                        {
                            method: "GET",
                            headers: {
                                "Authorization": `Bearer ${apiKey}`
                            }
                        }
                    );
                } catch (err) {
                    return res.status(502).json({
                        error: "Could not poll reverse image search.",
                        stage: "quanticdata-poll",
                        status: 502,
                        details: err.message
                    });
                }

                const pollText = await pollResponse.text();

                let pollData;

                try {
                    pollData = JSON.parse(pollText);
                } catch {
                    return res.status(502).json({
                        error: "Reverse image search polling returned invalid JSON.",
                        stage: "quanticdata-poll",
                        status: pollResponse.status,
                        details: pollText
                    });
                }

                finalData = pollData;

                const status =
                    pollData.status ||
                    pollData.data?.status ||
                    "";

                if (
                    status === "completed" ||
                    status === "success" ||
                    status === "succeeded" ||
                    pollData.completed === true
                ) {
                    break;
                }

                if (
                    status === "failed" ||
                    status === "error"
                ) {
                    return res.status(502).json({
                        error:
                            pollData.message ||
                            pollData.error ||
                            "Reverse image search failed.",
                        stage: "quanticdata-poll",
                        status: 502,
                        details: pollData
                    });
                }
            }
        }

        /*
         * Extract results from the various possible
         * QuanticData response structures.
         */
        const results =
            finalData.results ||
            finalData.data?.results ||
            finalData.data ||
            finalData.output ||
            finalData.items ||
            [];

        const resultArray = Array.isArray(results)
            ? results
            : [];

        const normalizedResults = resultArray.map((item, index) => ({
            rank:
                item.rank ||
                item.position ||
                index + 1,

            title:
                item.title ||
                item.name ||
                item.page_title ||
                "Untitled result",

            host:
                item.host ||
                item.domain ||
                item.source_domain ||
                "",

            source:
                item.source ||
                item.site ||
                item.domain ||
                "",

            pageUrl:
                item.page_url ||
                item.url ||
                item.link ||
                "",

            imageUrl:
                item.image_url ||
                item.image ||
                item.original_image ||
                "",

            thumbnail:
                item.thumbnail ||
                item.thumbnail_url ||
                item.image_thumbnail ||
                "",

            date:
                item.date ||
                item.published_at ||
                "",

            size:
                item.size ||
                "",

            exactMatch:
                item.exact_match ??
                item.exactMatch ??
                false
        }));

        return res.status(200).json({
            success: true,
            imageUrl,
            results: normalizedResults,
            raw: finalData
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
