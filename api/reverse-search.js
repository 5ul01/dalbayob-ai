import FormData from "form-data";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed.",
            stage: "request",
            status: 405
        });
    }

    try {
        const { image } = req.body || {};

        if (!image) {
            return res.status(400).json({
                error: "No image was provided.",
                stage: "request",
                status: 400
            });
        }

        let imageUrl = image;

        /*
         * =========================================================
         * IMAGE HANDLING
         * =========================================================
         *
         * If the image is already a public HTTP/HTTPS URL,
         * send it directly to Google Lens through QuanticData.
         *
         * If it is a base64 data URL, upload it first.
         */

        if (
            typeof image === "string" &&
            image.startsWith("data:image/")
        ) {
            imageUrl = await uploadBase64Image(image);
        } else if (
            typeof image === "string" &&
            /^https?:\/\//i.test(image)
        ) {
            imageUrl = image;
        } else {
            throw createError(
                "Unsupported image format.",
                "image",
                400,
                {
                    received:
                        typeof image === "string"
                            ? image.substring(0, 100)
                            : typeof image
                }
            );
        }


        /*
         * =========================================================
         * QUANTICDATA / GOOGLE LENS
         * =========================================================
         */

        const apiKey =
            process.env.QD_API_KEY;

        if (!apiKey) {
            throw createError(
                "QD_API_KEY is not configured in Vercel environment variables.",
                "quanticdata-auth",
                500
            );
        }


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
                        image_url: imageUrl,
                        max_results: 20
                    })
                }
            );


        const lensText =
            await lensResponse.text();


        const lensData =
            parseJsonSafely(lensText);


        /*
         * =========================================================
         * QUANTICDATA ERROR
         * =========================================================
         */

        if (!lensResponse.ok) {

            throw createError(
                getApiMessage(
                    lensData,
                    lensText,
                    "Google Lens API returned an error."
                ),
                "quanticdata",
                lensResponse.status,
                lensData || lensText
            );
        }


        /*
         * =========================================================
         * RESPONSE
         * =========================================================
         */

        let payload =
            extractPayload(lensData);


        /*
         * =========================================================
         * ASYNC RUN
         * =========================================================
         *
         * QuanticData may return HTTP 202 with a run ID.
         */

        if (
            lensResponse.status === 202 ||
            isPendingResponse(payload)
        ) {

            const runId =
                findRunId(lensData);

            if (!runId) {

                throw createError(
                    "Google Lens request was accepted but no run ID was returned.",
                    "quanticdata-poll",
                    202,
                    lensData
                );

            }


            payload =
                await pollRun(
                    runId,
                    apiKey
                );

        }


        /*
         * =========================================================
         * RESULTS
         * =========================================================
         */

        const results =
            extractResults(payload);


        if (!Array.isArray(results)) {

            throw createError(
                "Google Lens returned an unexpected response format.",
                "quanticdata-response",
                lensResponse.status,
                payload
            );

        }


        const normalized =
            results.map(
                normalizeResult
            );


        return res.status(200).json({
            success: true,
            count: normalized.length,
            results: normalized
        });

    } catch (error) {

        console.error(
            "Reverse image search failed:",
            error
        );


        return res.status(
            Number(error.status) || 500
        ).json({

            error:
                error.message ||
                "Reverse image search failed.",

            stage:
                error.stage ||
                "unknown",

            status:
                Number(error.status) || 500,

            details:
                error.details ||
                null

        });

    }
}


/*
 * =========================================================
 * UPLOAD BASE64 IMAGE
 * =========================================================
 */

async function uploadBase64Image(dataUrl) {

    const match =
        dataUrl.match(
            /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s
        );


    if (!match) {

        throw createError(
            "Invalid base64 image data.",
            "image",
            400
        );

    }


    const mimeType =
        match[1];

    const base64Data =
        match[2];


    const buffer =
        Buffer.from(
            base64Data,
            "base64"
        );


    if (!buffer.length) {

        throw createError(
            "The image data is empty.",
            "image",
            400
        );

    }


    /*
     * IMPORTANT:
     *
     * tmpfiles expects the multipart field to be named "file".
     */

    const form =
        new FormData();


    form.append(
        "file",
        buffer,
        {
            filename:
                getFilename(
                    mimeType
                ),

            contentType:
                mimeType
        }
    );


    let uploadResponse;

    try {

        uploadResponse =
            await fetch(
                "https://tmpfiles.org/api/v1/upload",
                {
                    method: "POST",

                    headers:
                        form.getHeaders(),

                    body: form
                }
            );

    } catch (error) {

        throw createError(
            "Could not connect to the temporary image upload service.",
            "tmpfiles",
            502,
            {
                message:
                    error.message
            }
        );

    }


    const uploadText =
        await uploadResponse.text();


    const uploadData =
        parseJsonSafely(
            uploadText
        );


    if (!uploadResponse.ok) {

        throw createError(
            getApiMessage(
                uploadData,
                uploadText,
                "Could not temporarily upload the image."
            ),
            "tmpfiles",
            uploadResponse.status,
            uploadData || uploadText
        );

    }


    /*
     * tmpfiles normally returns:
     *
     * {
     *   status: "success",
     *   data: {
     *      url: "https://tmpfiles.org/123/image.png"
     *   }
     * }
     */


    const originalUrl =
        uploadData?.data?.url ||
        uploadData?.url;


    if (!originalUrl) {

        throw createError(
            "Temporary image upload succeeded but no image URL was returned.",
            "tmpfiles-response",
            uploadResponse.status,
            uploadData
        );

    }


    /*
     * Convert:
     *
     * https://tmpfiles.org/123/image.png
     *
     * into:
     *
     * https://tmpfiles.org/dl/123/image.png
     *
     */

    const publicUrl =
        convertTmpfilesUrl(
            originalUrl
        );


    return publicUrl;
}


/*
 * =========================================================
 * TMPFILES URL
 * =========================================================
 */

function convertTmpfilesUrl(url) {

    try {

        const parsed =
            new URL(url);


        if (
            parsed.hostname !==
            "tmpfiles.org"
        ) {
            return url;
        }


        if (
            parsed.pathname.startsWith(
                "/dl/"
            )
        ) {
            return url;
        }


        const parts =
            parsed.pathname
                .split("/")
                .filter(Boolean);


        if (parts.length >= 2) {

            return (
                "https://tmpfiles.org/dl/" +
                parts.join("/")
            );

        }


        return url;

    } catch {

        return url;

    }

}


/*
 * =========================================================
 * POLL QUANTICDATA RUN
 * =========================================================
 */

async function pollRun(
    runId,
    apiKey
) {

    const maxAttempts = 30;

    const delayMs = 1500;


    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        await sleep(
            delayMs
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


        const data =
            parseJsonSafely(
                text
            );


        if (!response.ok) {

            throw createError(
                getApiMessage(
                    data,
                    text,
                    "Google Lens polling failed."
                ),
                "quanticdata-poll",
                response.status,
                data || text
            );

        }


        const payload =
            extractPayload(
                data
            );


        const status =
            String(
                payload?.status ||
                data?.status ||
                ""
            ).toLowerCase();


        if (
            status === "done" ||
            status === "completed" ||
            status === "success" ||
            Array.isArray(
                payload?.results
            ) ||
            Array.isArray(
                data?.results
            )
        ) {

            return payload;

        }


        if (
            status === "failed" ||
            status === "error" ||
            status === "cancelled"
        ) {

            throw createError(
                getApiMessage(
                    payload,
                    text,
                    "Google Lens search failed."
                ),
                "quanticdata-poll",
                response.status,
                payload
            );

        }

    }


    throw createError(
        "Google Lens search timed out while waiting for results.",
        "quanticdata-poll",
        504,
        {
            runId
        }
    );

}


/*
 * =========================================================
 * EXTRACT PAYLOAD
 * =========================================================
 */

function extractPayload(data) {

    if (!data)
        return data;


    if (
        data.payload &&
        typeof data.payload === "object"
    ) {
        return data.payload;
    }


    return data;

}


/*
 * =========================================================
 * EXTRACT RESULTS
 * =========================================================
 */

function extractResults(data) {

    if (!data)
        return null;


    if (
        Array.isArray(
            data.results
        )
    ) {
        return data.results;
    }


    if (
        data.payload &&
        Array.isArray(
            data.payload.results
        )
    ) {
        return data.payload.results;
    }


    if (
        data.data &&
        Array.isArray(
            data.data.results
        )
    ) {
        return data.data.results;
    }


    return null;

}


/*
 * =========================================================
 * FIND RUN ID
 * =========================================================
 */

function findRunId(data) {

    return (
        data?.run_id ||
        data?.runId ||
        data?.id ||
        data?.payload?.run_id ||
        data?.payload?.runId ||
        data?.payload?.id ||
        data?.data?.run_id ||
        data?.data?.runId ||
        data?.data?.id ||
        null
    );

}


/*
 * =========================================================
 * PENDING RESPONSE
 * =========================================================
 */

function isPendingResponse(data) {

    const status =
        String(
            data?.status || ""
        ).toLowerCase();


    return (
        status === "pending" ||
        status === "processing" ||
        status === "queued" ||
        status === "running"
    );

}


/*
 * =========================================================
 * NORMALIZE RESULT
 * =========================================================
 */

function normalizeResult(
    result,
    index
) {

    const pageUrl =
        result?.link ||
        result?.url ||
        result?.page_url ||
        result?.pageUrl ||
        "";


    const imageUrl =
        result?.image ||
        result?.image_url ||
        result?.imageUrl ||
        result?.original_image ||
        result?.original_image_url ||
        "";


    const thumbnail =
        result?.thumbnail ||
        result?.thumbnail_url ||
        result?.thumbnailUrl ||
        result?.image ||
        "";


    const title =
        result?.title ||
        result?.name ||
        result?.text ||
        "Untitled result";


    const host =
        result?.domain ||
        result?.host ||
        result?.source ||
        getHostname(pageUrl);


    return {

        rank:
            result?.rank ||
            index + 1,

        title,

        host,

        source:
            result?.source ||
            host,

        pageUrl,

        imageUrl,

        thumbnail,

        date:
            result?.date ||
            result?.published_at ||
            "",

        size:
            result?.size ||
            "",

        exactMatch:
            Boolean(
                result?.exact_match ||
                result?.exactMatch ||
                false
            )

    };

}


/*
 * =========================================================
 * HOSTNAME
 * =========================================================
 */

function getHostname(
    value
) {

    if (!value)
        return "";


    try {

        return new URL(
            value
        ).hostname;

    } catch {

        return "";

    }

}


/*
 * =========================================================
 * JSON PARSER
 * =========================================================
 */

function parseJsonSafely(
    text
) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }


    try {

        return JSON.parse(
            text
        );

    } catch {

        return null;

    }

}


/*
 * =========================================================
 * API MESSAGE
 * =========================================================
 */

function getApiMessage(
    data,
    rawText,
    fallback
) {

    if (
        data?.message
    ) {
        return data.message;
    }


    if (
        data?.error?.message
    ) {
        return data.error.message;
    }


    if (
        typeof data?.error === "string"
    ) {
        return data.error;
    }


    if (
        typeof rawText === "string" &&
        rawText.trim()
    ) {
        return rawText.substring(
            0,
            1000
        );
    }


    return fallback;

}


/*
 * =========================================================
 * ERROR BUILDER
 * =========================================================
 */

function createError(
    message,
    stage,
    status,
    details = null
) {

    const error =
        new Error(
            message
        );


    error.stage =
        stage;

    error.status =
        status;

    error.details =
        details;


    return error;

}


/*
 * =========================================================
 * FILENAME
 * =========================================================
 */

function getFilename(
    mimeType
) {

    const extension =
        mimeType
            .split("/")
            .pop()
            ?.split("+")[0] ||
        "png";


    return `dalbayob-${Date.now()}.${extension}`;

}


/*
 * =========================================================
 * SLEEP
 * =========================================================
 */

function sleep(
    ms
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}import FormData from "form-data";

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
