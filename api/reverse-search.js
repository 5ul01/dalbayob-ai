import FormData from "form-data";

export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed.",
            stage: "request",
            status: 405
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

    try {

        const { image } = req.body || {};

        if (!image) {
            return res.status(400).json({
                error: "No image was provided.",
                stage: "input",
                status: 400
            });
        }

        if (typeof image !== "string") {
            return res.status(400).json({
                error: "Image must be a string.",
                stage: "input",
                status: 400
            });
        }


        /*
         * =====================================================
         * PREPARE IMAGE URL
         * =====================================================
         */

        let publicImageUrl = "";


        /*
         * CASE 1:
         * Image is already a public HTTP/HTTPS URL
         *
         * This is important for generated Pollinations images.
         */

        if (
            image.startsWith("https://") ||
            image.startsWith("http://")
        ) {

            publicImageUrl = image;

        }


        /*
         * CASE 2:
         * Image is a base64 data URL
         */

        else if (image.startsWith("data:image/")) {

            const match =
                image.match(
                    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
                );

            if (!match) {

                return res.status(400).json({
                    error: "Invalid base64 image data.",
                    stage: "input",
                    status: 400
                });

            }

            const mimeType = match[1];
            const base64Data = match[2];

            const buffer =
                Buffer.from(
                    base64Data,
                    "base64"
                );

            if (!buffer.length) {

                return res.status(400).json({
                    error: "The image appears to be empty.",
                    stage: "image-processing",
                    status: 400
                });

            }

            if (
                buffer.length >
                15 * 1024 * 1024
            ) {

                return res.status(413).json({
                    error: "Image is too large. Maximum size is 15 MB.",
                    stage: "image-processing",
                    status: 413
                });

            }

            const extension =
                mimeType.split("/")[1] ||
                "png";


            /*
             * =================================================
             * UPLOAD BASE64 IMAGE TO TMPFILES
             * =================================================
             */

            const form =
                new FormData();

            form.append(
                "file",
                buffer,
                {
                    filename:
                        `dalbayob.${extension}`,

                    contentType:
                        mimeType
                }
            );


            const uploadResponse =
                await fetch(
                    "https://tmpfiles.org/api/v1/upload",
                    {
                        method: "POST",

                        body: form,

                        headers:
                            form.getHeaders()
                    }
                );


            const uploadText =
                await uploadResponse.text();


            let uploadData;

            try {

                uploadData =
                    JSON.parse(
                        uploadText
                    );

            } catch {

                console.error(
                    "tmpfiles invalid response:",
                    uploadText
                );

                return res.status(502).json({

                    error:
                        "Temporary image hosting returned invalid data.",

                    stage:
                        "tmpfiles",

                    status:
                        uploadResponse.status,

                    details:
                        uploadText

                });

            }


            if (
                !uploadResponse.ok ||
                uploadData?.status !== "success" ||
                !uploadData?.data?.url
            ) {

                console.error(
                    "tmpfiles response:",
                    uploadData
                );

                return res.status(502).json({

                    error:
                        "Could not temporarily upload the image.",

                    stage:
                        "tmpfiles",

                    status:
                        uploadResponse.status,

                    details:
                        uploadData

                });

            }


            publicImageUrl =
                uploadData.data.url;


            /*
             * Convert:
             *
             * https://tmpfiles.org/123/image.png
             *
             * Into:
             *
             * https://tmpfiles.org/dl/123/image.png
             */

            if (
                publicImageUrl.startsWith(
                    "https://tmpfiles.org/"
                )
            ) {

                publicImageUrl =
                    publicImageUrl.replace(
                        "https://tmpfiles.org/",
                        "https://tmpfiles.org/dl/"
                    );

            }

        }


        /*
         * =====================================================
         * INVALID IMAGE FORMAT
         * =====================================================
         */

        else {

            return res.status(400).json({

                error:
                    "Unsupported image format. Use an uploaded image or a public HTTP/HTTPS image URL.",

                stage:
                    "input",

                status:
                    400

            });

        }


        console.log(
            "Reverse search image URL:",
            publicImageUrl
        );


        /*
         * =====================================================
         * GOOGLE LENS / QUANTICDATA
         * =====================================================
         */

        const lensResponse =
            await fetch(
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

                        max_results:
                            20

                    })

                }
            );


        const lensText =
            await lensResponse.text();


        let lensData;

        try {

            lensData =
                JSON.parse(
                    lensText
                );

        } catch {

            console.error(
                "QuanticData non-JSON response:",
                lensText
            );

            return res.status(502).json({

                error:
                    "QuanticData returned invalid JSON.",

                stage:
                    "quanticdata",

                status:
                    lensResponse.status,

                details:
                    lensText

            });

        }


        console.log(
            "QuanticData HTTP status:",
            lensResponse.status
        );

        console.log(
            "QuanticData response:",
            JSON.stringify(
                lensData,
                null,
                2
            )
        );


        /*
         * =====================================================
         * QUANTICDATA EXPLICIT ERROR
         * =====================================================
         */

        if (
            lensData?.type === "error"
        ) {

            return res.status(
                lensResponse.status >= 400
                    ? lensResponse.status
                    : 502
            ).json({

                error:
                    lensData.message ||
                    lensData.error ||
                    "Google Lens API returned an error.",

                stage:
                    "quanticdata",

                status:
                    lensResponse.status,

                details:
                    lensData

            });

        }


        /*
         * =====================================================
         * HTTP ERROR
         * =====================================================
         */

        if (
            !lensResponse.ok &&
            lensResponse.status !== 202
        ) {

            return res.status(
                lensResponse.status
            ).json({

                error:
                    lensData?.message ||
                    lensData?.error ||
                    "Google Lens request failed.",

                stage:
                    "quanticdata",

                status:
                    lensResponse.status,

                details:
                    lensData

            });

        }


        /*
         * =====================================================
         * ASYNC RESPONSE
         * =====================================================
         */

        if (
            lensResponse.status === 202
        ) {

            const runId =
                lensData?.payload?.run_id ||
                lensData?.payload?.runId ||
                lensData?.run_id ||
                lensData?.runId ||
                lensData?.id;


            if (!runId) {

                console.error(
                    "202 without run ID:",
                    lensData
                );

                return res.status(502).json({

                    error:
                        "Google Lens started an asynchronous search but did not return a run ID.",

                    stage:
                        "quanticdata",

                    status:
                        202,

                    details:
                        lensData

                });

            }


            console.log(
                "Google Lens run ID:",
                runId
            );


            const results =
                await pollQuanticDataRun(
                    runId,
                    apiKey
                );


            return res.status(200).json({

                success:
                    true,

                results,

                count:
                    results.length

            });

        }


        /*
         * =====================================================
         * DIRECT RESULTS
         * =====================================================
         */

        const rawResults =
            lensData?.payload?.results ||
            lensData?.results ||
            [];


        if (
            !Array.isArray(rawResults)
        ) {

            console.error(
                "Unexpected QuanticData response:",
                lensData
            );

            return res.status(502).json({

                error:
                    "Google Lens API returned an unexpected response format.",

                stage:
                    "quanticdata",

                status:
                    lensResponse.status,

                details:
                    lensData

            });

        }


        const results =
            normalizeResults(
                rawResults
            );


        return res.status(200).json({

            success:
                true,

            results,

            count:
                results.length,

            cost:
                lensData?.payload?.usage?.cost_usd ??
                lensData?.cost ??
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
                "Reverse image search failed.",

            stage:
                "server",

            status:
                500,

            details:
                error?.stack ||
                null

        });

    }

}


/* =========================================================
   NORMALIZE RESULTS
========================================================= */

function normalizeResults(
    rawResults
) {

    return rawResults
        .map(
            (result, index) => {

                if (
                    !result ||
                    typeof result !== "object"
                ) {

                    return null;

                }


                return {

                    rank:
                        result.rank ??
                        index + 1,

                    title:
                        result.title ||
                        "Untitled result",

                    host:
                        result.domain ||
                        result.host ||
                        result.source ||
                        "Unknown source",

                    source:
                        result.source ||
                        "",

                    pageUrl:
                        result.link ||
                        result.url ||
                        result.page_url ||
                        "",

                    imageUrl:
                        result.image ||
                        result.image_url ||
                        "",

                    thumbnail:
                        result.thumbnail ||
                        result.thumbnail_url ||
                        "",

                    date:
                        result.date ||
                        null,

                    size:
                        result.size ||
                        null,

                    exactMatch:
                        Boolean(
                            result.exact_match ??
                            result.exactMatch ??
                            false
                        )

                };

            }
        )
        .filter(Boolean);

}


/* =========================================================
   POLL ASYNC QUANTICDATA RUN
========================================================= */

async function pollQuanticDataRun(
    runId,
    apiKey
) {

    const maxAttempts = 30;


    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    2000
                )
        );


        const response =
            await fetch(
                `https://api.quanticdata.io/v1/scraper/collectors/runs/${encodeURIComponent(runId)}`,
                {
                    method: "GET",

                    headers: {

                        "Authorization":
                            `Bearer ${apiKey}`

                    }

                }
            );


        const text =
            await response.text();


        let data;

        try {

            data =
                JSON.parse(text);

        } catch {

            throw new Error(
                `Google Lens polling returned invalid JSON. HTTP ${response.status}. Response: ${text}`
            );

        }


        console.log(
            `Lens polling attempt ${attempt + 1}:`,
            JSON.stringify(data)
        );


        /*
         * =====================================================
         * POLLING HTTP ERROR
         * =====================================================
         */

        if (!response.ok) {

            const error =
                new Error(
                    data?.message ||
                    data?.error ||
                    `Google Lens polling failed (${response.status}).`
                );

            error.stage =
                "quanticdata-polling";

            error.status =
                response.status;

            error.details =
                data;

            throw error;

        }


        const status =
            data?.payload?.status ||
            data?.status;


        /*
         * =====================================================
         * COMPLETE
         * =====================================================
         */

        if (
            status === "done" ||
            status === "completed" ||
            status === "success"
        ) {

            const results =
                data?.payload?.results ||
                data?.results ||
                [];


            if (
                !Array.isArray(results)
            ) {

                throw new Error(
                    "Google Lens completed but returned invalid results."
                );

            }


            return normalizeResults(
                results
            );

        }


        /*
         * =====================================================
         * FAILED
         * =====================================================
         */

        if (
            status === "failed" ||
            status === "error"
        ) {

            const error =
                new Error(
                    data?.payload?.message ||
                    data?.message ||
                    data?.error ||
                    "Google Lens search failed."
                );

            error.stage =
                "quanticdata-polling";

            error.status =
                response.status;

            error.details =
                data;

            throw error;

        }

    }


    throw new Error(
        "Google Lens search timed out after 60 seconds."
    );

}
