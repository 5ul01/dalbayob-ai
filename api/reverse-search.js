function sendError(res, status, message) {
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

    const commaIndex =
        dataUrl.indexOf(",");

    if (commaIndex === -1) {
        return null;
    }

    return dataUrl.slice(
        commaIndex + 1
    );
}

function cleanHost(host) {
    if (!host) {
        return "";
    }

    return host
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return sendError(
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
            return sendError(
                res,
                400,
                "A valid image is required."
            );
        }

        const base64 =
            extractBase64(image);

        if (!base64) {
            return sendError(
                res,
                400,
                "Invalid image data."
            );
        }

        /*
         * Protect the server from enormous
         * browser payloads.
         *
         * Base64 is roughly 4/3 the size
         * of the original binary image.
         */
        if (base64.length > 15_000_000) {
            return sendError(
                res,
                413,
                "Image is too large. Please use an image under roughly 10 MB."
            );
        }

        const apiKey =
            process.env.YANDEX_API_KEY;

        const folderId =
            process.env.YANDEX_FOLDER_ID;

        if (!apiKey) {
            return sendError(
                res,
                500,
                "YANDEX_API_KEY is missing in Vercel."
            );
        }

        if (!folderId) {
            return sendError(
                res,
                500,
                "YANDEX_FOLDER_ID is missing in Vercel."
            );
        }

        const yandexResponse =
            await fetch(
                "https://searchapi.api.cloud.yandex.net/v2/image/search_by_image",
                {
                    method: "POST",

                    headers: {
                        "Authorization":
                            "Api-Key " +
                            apiKey,

                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        folderId:
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

        const rawText =
            await yandexResponse.text();

        if (!yandexResponse.ok) {
            console.error(
                "Yandex reverse search error:",
                rawText
            );

            return sendError(
                res,
                yandexResponse.status,
                "Yandex image search failed."
            );
        }

        let data;

        try {
            data =
                JSON.parse(rawText);
        } catch {
            return sendError(
                res,
                502,
                "Yandex returned invalid JSON."
            );
        }

        const images =
            Array.isArray(data.images)
                ? data.images
                : [];

        /*
         * Normalize Yandex's response into
         * a format that the frontend can
         * easily display.
         */
        const results =
            images
                .map((item) => {
                    const pageUrl =
                        item.pageUrl || "";

                    const imageUrl =
                        item.url || "";

                    const title =
                        item.pageTitle ||
                        "Untitled result";

                    const host =
                        cleanHost(
                            item.host ||
                            pageUrl
                        );

                    return {
                        title,
                        host,
                        pageUrl,
                        imageUrl,
                        passage:
                            item.passage || "",
                        width:
                            item.width || null,
                        height:
                            item.height || null
                    };
                })
                .filter(
                    (item) =>
                        item.pageUrl ||
                        item.imageUrl
                );

        /*
         * Remove duplicate page URLs.
         */
        const seen =
            new Set();

        const uniqueResults =
            results.filter((item) => {
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

            results:
                uniqueResults,

            page:
                Number(data.page || 0),

            maxPage:
                Number(data.maxPage || 0),

            searchId:
                data.id || null
        });

    } catch (error) {
        console.error(
            "Reverse search error:",
            error
        );

        return sendError(
            res,
            500,
            error?.message ||
                "Reverse image search failed."
        );
    }
}
