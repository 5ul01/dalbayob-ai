function errorResponse(res, status, message) {
    return res.status(status).json({
        success: false,
        error: message
    });
}


function extractBase64(dataUrl) {

    if (
        typeof dataUrl !== "string" ||
        !dataUrl.startsWith("data:image/")
    ) {
        return null;
    }


    const comma =
        dataUrl.indexOf(",");


    if (comma === -1) {
        return null;
    }


    return dataUrl.slice(
        comma + 1
    );
}


function getHost(value) {

    if (!value) {
        return "";
    }


    try {

        return new URL(value)
            .hostname
            .replace(/^www\./, "");

    } catch {

        return "";

    }

}


export default async function handler(
    req,
    res
) {

    if (req.method !== "POST") {

        return errorResponse(
            res,
            405,
            "Method not allowed."
        );

    }


    try {

        const body =
            req.body || {};


        const image =
            body.image;


        if (
            typeof image !== "string" ||
            !image.startsWith("data:image/")
        ) {

            return errorResponse(
                res,
                400,
                "A valid image is required."
            );

        }


        const base64 =
            extractBase64(image);


        if (!base64) {

            return errorResponse(
                res,
                400,
                "Invalid image data."
            );

        }


        /*
         * Prevent extremely large requests.
         */

        if (
            base64.length >
            15_000_000
        ) {

            return errorResponse(
                res,
                413,
                "Image is too large. Please use a smaller image."
            );

        }


        const apiKey =
            process.env.YANDEX_API_KEY;


        const folderId =
            process.env.YANDEX_FOLDER_ID;


        if (!apiKey) {

            return errorResponse(
                res,
                500,
                "YANDEX_API_KEY is not configured."
            );

        }


        if (!folderId) {

            return errorResponse(
                res,
                500,
                "YANDEX_FOLDER_ID is not configured."
            );

        }


        /*
         * Yandex Image Search API.
         */

        const response =
            await fetch(
                "https://searchapi.api.cloud.yandex.net/v2/image/search_by_image",
                {
                    method: "POST",

                    headers: {

                        "Authorization":
                            `Api-Key ${apiKey}`,

                        "Content-Type":
                            "application/json"

                    },

                    body: JSON.stringify({

                        folderId,

                        data:
                            base64,

                        page:
                            "0",

                        familyMode:
                            "FAMILY_MODE_MODERATE"

                    })

                }
            );


        const raw =
            await response.text();


        if (!response.ok) {

            console.error(
                "Yandex error:",
                raw
            );


            return errorResponse(
                res,
                response.status,
                "Yandex reverse image search failed."
            );

        }


        let data;


        try {

            data =
                JSON.parse(raw);

        } catch {

            return errorResponse(
                res,
                502,
                "Yandex returned invalid data."
            );

        }


        /*
         * Be defensive about response
         * formats.
         */

        const source =
            Array.isArray(data.images)
                ? data.images
                : Array.isArray(data.results)
                    ? data.results
                    : [];


        const normalized =
            source
                .map(item => {

                    const pageUrl =
                        item.pageUrl ||
                        item.page_url ||
                        item.url ||
                        "";


                    const imageUrl =
                        item.imageUrl ||
                        item.image_url ||
                        item.thumbnail ||
                        item.url ||
                        "";


                    const title =
                        item.pageTitle ||
                        item.page_title ||
                        item.title ||
                        "Image result";


                    const host =
                        item.host ||
                        getHost(pageUrl);


                    return {

                        title:
                            String(title),

                        host:
                            String(host),

                        pageUrl:
                            String(pageUrl),

                        imageUrl:
                            String(imageUrl),

                        passage:
                            item.passage ||
                            ""

                    };

                })


                .filter(item => {

                    return (
                        item.pageUrl ||
                        item.imageUrl
                    );

                });


        /*
         * Remove duplicate URLs.
         */

        const seen =
            new Set();


        const results =
            normalized.filter(item => {

                const key =
                    item.pageUrl ||
                    item.imageUrl;


                if (seen.has(key)) {
                    return false;
                }


                seen.add(key);


                return true;

            });


        return res.status(200).json({

            success: true,

            results,

            count:
                results.length

        });


    } catch (error) {

        console.error(
            "Reverse search error:",
            error
        );


        return errorResponse(
            res,
            500,
            error?.message ||
            "Reverse image search failed."
        );

    }

}
