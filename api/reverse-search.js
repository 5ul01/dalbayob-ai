import FormData from "form-data";

export default async function handler(req, res) {

    if (req.method !== "POST") {

        return res.status(405).json({
            error: "Method not allowed."
        });

    }


    const apiKey =
        process.env.QD_API_KEY;


    if (!apiKey) {

        return res.status(500).json({
            error:
                "QD_API_KEY is not configured in Vercel."
        });

    }


    try {

        const { image } =
            req.body || {};


        if (!image) {

            return res.status(400).json({
                error:
                    "No image was provided."
            });

        }


        if (
            typeof image !== "string" ||
            !image.startsWith("data:image/")
        ) {

            return res.status(400).json({
                error:
                    "The uploaded image must be a base64 image."
            });

        }


        /*
         * =====================================================
         * CONVERT DATA URL
         * =====================================================
         */

        const match =
            image.match(
                /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
            );


        if (!match) {

            return res.status(400).json({
                error:
                    "Invalid image data."
            });

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

            return res.status(400).json({
                error:
                    "The image appears to be empty."
            });

        }


        if (
            buffer.length >
            15 * 1024 * 1024
        ) {

            return res.status(413).json({
                error:
                    "Image is too large. Maximum size is 15 MB."
            });

        }


        const extension =
            mimeType.split("/")[1] ||
            "png";


        /*
         * =====================================================
         * UPLOAD TO TMPFILES
         * =====================================================
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

            throw new Error(
                "Temporary image hosting returned invalid data."
            );

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

            throw new Error(
                "Could not temporarily upload the image."
            );

        }


        /*
         * tmpfiles returns:
         *
         * https://tmpfiles.org/123/image.png
         *
         * Convert it into:
         *
         * https://tmpfiles.org/dl/123/image.png
         */

        let publicImageUrl =
            uploadData.data.url;


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


        console.log(
            "Temporary image URL:",
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

            throw new Error(
                "Google Lens API returned invalid data."
            );

        }


        console.log(
            "QuanticData status:",
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
         * API ERROR
         * =====================================================
         */

        if (
            lensData?.type === "error"
        ) {

            throw new Error(
                lensData.message ||
                "Google Lens API returned an error."
            );

        }


        if (
            !lensResponse.ok &&
            lensResponse.status !== 202
        ) {

            throw new Error(
                lensData?.message ||
                lensData?.error ||
                `Google Lens request failed (${lensResponse.status}).`
            );

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

                throw new Error(
                    "Google Lens started an asynchronous search but did not return a run ID."
                );

            }


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
         * EXTRACT RESULTS
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
                "Unexpected response:",
                lensData
            );

            throw new Error(
                "Google Lens API returned an unexpected response format."
            );

        }


        /*
         * =====================================================
         * NORMALIZE RESULTS
         * =====================================================
         */

        const results =
            rawResults
                .map(
                    (result, index) => {

                        if (
                            !result ||
                            typeof result !==
                                "object"
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
                "Reverse image search failed."

        });

    }

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
                "Google Lens polling returned invalid data."
            );

        }


        console.log(
            `Lens polling attempt ${attempt + 1}:`,
            JSON.stringify(data)
        );


        if (!response.ok) {

            throw new Error(
                data?.message ||
                data?.error ||
                `Google Lens polling failed (${response.status}).`
            );

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


            return results
                .map(
                    (result, index) => {

                        if (
                            !result ||
                            typeof result !==
                                "object"
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


        /*
         * =====================================================
         * FAILED
         * =====================================================
         */

        if (
            status === "failed" ||
            status === "error"
        ) {

            throw new Error(
                data?.payload?.message ||
                data?.message ||
                "Google Lens search failed."
            );

        }

    }


    throw new Error(
        "Google Lens search timed out."
    );

}
