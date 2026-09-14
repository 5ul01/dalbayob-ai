export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { prompt, image } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "No edit instruction provided"
      });
    }

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "No source image provided"
      });
    }

    // Your existing ComfyUI tunnel.
    const comfyUrl =
      "https://phantom-smudge-voting.ngrok-free.dev";

    /*
     * =========================================================
     * 1. PREPARE SOURCE IMAGE
     * =========================================================
     */

    let imageBlob;

    if (image.startsWith("data:")) {
      const match = image.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image data"
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

      imageBlob = new Blob(
        [
          Buffer.from(base64Data, "base64")
        ],
        {
          type: mimeType
        }
      );
    } else {
      const sourceResponse = await fetch(image);

      if (!sourceResponse.ok) {
        return res.status(400).json({
          error: "Could not download source image"
        });
      }

      const buffer = Buffer.from(
        await sourceResponse.arrayBuffer()
      );

      imageBlob = new Blob(
        [buffer],
        {
          type:
            sourceResponse.headers.get(
              "content-type"
            ) || "image/png"
        }
      );
    }

    /*
     * Determine a safe filename.
     */

    let extension = "png";

    if (imageBlob.type === "image/jpeg") {
      extension = "jpg";
    } else if (imageBlob.type === "image/webp") {
      extension = "webp";
    }

    const uploadName =
      `dalbayob-edit-${Date.now()}.${extension}`;

    /*
     * =========================================================
     * 2. UPLOAD IMAGE TO COMFYUI
     * =========================================================
     */

    const form = new FormData();

    form.append(
      "image",
      imageBlob,
      uploadName
    );

    form.append(
      "overwrite",
      "true"
    );

    const uploadResponse = await fetch(
      `${comfyUrl}/upload/image`,
      {
        method: "POST",
        headers: {
          "ngrok-skip-browser-warning": "true"
        },
        body: form
      }
    );

    const uploadText =
      await uploadResponse.text();

    if (!uploadResponse.ok) {
      console.error(
        "ComfyUI image upload failed:",
        uploadText
      );

      return res.status(502).json({
        error:
          "ComfyUI rejected the source image upload",
        details:
          uploadText
      });
    }

    let uploadResult;

    try {
      uploadResult =
        JSON.parse(uploadText);
    } catch {
      return res.status(502).json({
        error:
          "ComfyUI returned invalid upload data",
        details:
          uploadText
      });
    }

    const uploadedFilename =
      uploadResult.name;

    if (!uploadedFilename) {
      return res.status(502).json({
        error:
          "ComfyUI did not return an uploaded filename",
        details:
          uploadResult
      });
    }

    console.log(
      "Dalbayob: uploaded edit image:",
      uploadedFilename
    );

    /*
     * =========================================================
     * 3. BUILD THE ACTUAL Z-IMAGE OMNI EDIT WORKFLOW
     * =========================================================
     *
     * This follows the workflow you exported from ComfyUI.
     *
     * 63 = LoadImage
     * 64 = VAEEncode
     * 66 = VAE
     * 67 = TextEncodeZImageOmni
     * 68 = KSampler
     * 69 = VAEDecode
     * 70 = Z-Image Turbo model
     * 71 = Qwen CLIP
     * 9  = SaveImage
     *
     * The important difference from the old backend is that
     * node 67 is TextEncodeZImageOmni, not CLIPTextEncode.
     */

    const workflow = {
      "9": {
        inputs: {
          filename_prefix:
            "dalbayob-edit",
          images: [
            "69",
            0
          ]
        },
        class_type:
          "SaveImage",
        _meta: {
          title:
            "Save Image"
        }
      },

      "63": {
        inputs: {
          image:
            uploadedFilename
        },
        class_type:
          "LoadImage",
        _meta: {
          title:
            "Load Image"
        }
      },

      "64": {
        inputs: {
          pixels: [
            "63",
            0
          ],
          vae: [
            "66",
            0
          ]
        },
        class_type:
          "VAEEncode",
        _meta: {
          title:
            "VAE Encode"
        }
      },

      "66": {
        inputs: {
          vae_name:
            "ae.safetensors"
        },
        class_type:
          "VAELoader",
        _meta: {
          title:
            "Load VAE"
        }
      },

      "67": {
        inputs: {
          prompt:
            prompt,

          auto_resize_images:
            true,

          clip: [
            "71",
            0
          ],

          image1: [
            "63",
            0
          ]
        },

        class_type:
          "TextEncodeZImageOmni",

        _meta: {
          title:
            "TextEncodeZImageOmni"
        }
      },

      "68": {
        inputs: {
          seed:
            Math.floor(
              Math.random() *
              999999999999999
            ),

          steps:
            8,

          cfg:
            1,

          sampler_name:
            "res_multistep",

          scheduler:
            "simple",

          /*
           * 0.45 gives the model more freedom to make
           * the requested modification while still
           * retaining the source image.
           */
          denoise:
            0.45,

          model: [
            "70",
            0
          ],

          positive: [
            "67",
            0
          ],

          latent_image: [
            "64",
            0
          ]
        },

        class_type:
          "KSampler",

        _meta: {
          title:
            "KSampler"
        }
      },

      "69": {
        inputs: {
          samples: [
            "68",
            0
          ],

          vae: [
            "66",
            0
          ]
        },

        class_type:
          "VAEDecode",

        _meta: {
          title:
            "VAE Decode"
        }
      },

      "70": {
        inputs: {
          unet_name:
            "z_image_turbo_bf16.safetensors",

          weight_dtype:
            "default"
        },

        class_type:
          "UNETLoader",

        _meta: {
          title:
            "Load Diffusion Model"
        }
      },

      "71": {
        inputs: {
          clip_name:
            "qwen_3_4b.safetensors",

          type:
            "stable_diffusion",

          device:
            "default"
        },

        class_type:
          "CLIPLoader",

        _meta: {
          title:
            "Load CLIP"
        }
      }
    };

    /*
     * =========================================================
     * 4. SEND WORKFLOW TO COMFYUI
     * =========================================================
     */

    console.log(
      "Dalbayob: sending Z-Image Omni edit workflow"
    );

    const promptResponse =
      await fetch(
        `${comfyUrl}/prompt`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "ngrok-skip-browser-warning":
              "true"
          },

          body:
            JSON.stringify({
              prompt:
                workflow
            })
        }
      );

    const promptText =
      await promptResponse.text();

    if (!promptResponse.ok) {
      console.error(
        "ComfyUI rejected edit workflow:",
        promptText
      );

      return res.status(502).json({
        error:
          "ComfyUI rejected the edit workflow",

        details:
          promptText
      });
    }

    let promptResult;

    try {
      promptResult =
        JSON.parse(
          promptText
        );
    } catch {
      return res.status(502).json({
        error:
          "ComfyUI returned invalid workflow data",

        details:
          promptText
      });
    }

    if (!promptResult.prompt_id) {
      return res.status(502).json({
        error:
          "ComfyUI did not return a prompt ID",

        details:
          promptResult
      });
    }

    const promptId =
      promptResult.prompt_id;

    console.log(
      "Dalbayob edit prompt ID:",
      promptId
    );

    /*
     * =========================================================
     * 5. WAIT FOR COMFYUI
     * =========================================================
     */

    let output = null;

    const maxAttempts = 180;

    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt++
    ) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1000
          )
      );

      const historyResponse =
        await fetch(
          `${comfyUrl}/history/${promptId}`,
          {
            headers: {
              "ngrok-skip-browser-warning":
                "true"
            }
          }
        );

      if (!historyResponse.ok) {
        continue;
      }

      const history =
        await historyResponse.json();

      if (!history[promptId]) {
        continue;
      }

      const execution =
        history[promptId];

      /*
       * ComfyUI execution error.
       */

      if (
        execution.status?.status_str ===
        "error"
      ) {
        console.error(
          "ComfyUI edit execution failed:",
          execution.status
        );

        return res.status(500).json({
          error:
            "ComfyUI failed while editing the image",

          details:
            execution.status
        });
      }

      /*
       * Still running.
       */

      if (
        execution.status?.completed !==
        true
      ) {
        continue;
      }

      /*
       * Node 9 is our SaveImage node.
       */

      if (
        execution.outputs?.["9"]?.images
          ?.length
      ) {
        output =
          execution.outputs[
            "9"
          ].images[0];

        break;
      }

      /*
       * Fallback:
       * search all output nodes for an image.
       */

      if (execution.outputs) {
        for (
          const nodeId of Object.keys(
            execution.outputs
          )
        ) {
          const nodeOutput =
            execution.outputs[
              nodeId
            ];

          if (
            nodeOutput &&
            Array.isArray(
              nodeOutput.images
            ) &&
            nodeOutput.images.length >
              0
          ) {
            output =
              nodeOutput.images[0];

            break;
          }
        }
      }

      if (output) {
        break;
      }
    }

    if (!output) {
      return res.status(504).json({
        error:
          "ComfyUI timed out before returning the edited image",

        prompt_id:
          promptId
      });
    }

    /*
     * =========================================================
     * 6. DOWNLOAD THE EDITED IMAGE
     * =========================================================
     */

    const filename =
      output.filename;

    const subfolder =
      output.subfolder || "";

    const type =
      output.type || "output";

    const imageParams =
      new URLSearchParams({
        filename,
        subfolder,
        type
      });

    const imageResponse =
      await fetch(
        `${comfyUrl}/view?${imageParams.toString()}`,
        {
          headers: {
            "ngrok-skip-browser-warning":
              "true"
          }
        }
      );

    if (!imageResponse.ok) {
      const errorText =
        await imageResponse.text();

      console.error(
        "Could not retrieve edited image:",
        errorText
      );

      return res.status(502).json({
        error:
          "Could not retrieve edited image from ComfyUI",

        details:
          errorText
      });
    }

    const imageBuffer =
      Buffer.from(
        await imageResponse.arrayBuffer()
      );

    const imageBase64 =
      imageBuffer.toString(
        "base64"
      );

    const imageDataUrl =
      `data:image/png;base64,${imageBase64}`;

    console.log(
      "Dalbayob: image edit completed:",
      filename
    );

    /*
     * =========================================================
     * 7. RETURN IMAGE TO DALBAYOB
     * =========================================================
     */

    return res.status(200).json({
      image:
        imageDataUrl,

      filename,

      prompt_id:
        promptId
    });

  } catch (error) {
    console.error(
      "Dalbayob image editing error:",
      error
    );

    return res.status(500).json({
      error:
        "Image editing failed",

      details:
        error.message
    });
  }
}
