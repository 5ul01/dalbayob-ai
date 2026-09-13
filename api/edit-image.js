export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      prompt,
      image
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "No edit prompt provided"
      });
    }

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "No source image provided"
      });
    }

    const comfyUrl =
      "https://phantom-smudge-voting.ngrok-free.dev";

    /*
     * ---------------------------------------------------------
     * 1. Convert the incoming image into a Blob
     * ---------------------------------------------------------
     */

    let imageBlob;
    let imageName = "dalbayob-edit.png";

    if (image.startsWith("data:image/")) {
      const match = image.match(
        /^data:(image\/[^;]+);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image data"
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

      const buffer = Buffer.from(
        base64Data,
        "base64"
      );

      imageBlob = new Blob(
        [buffer],
        { type: mimeType }
      );

      const extension =
        mimeType === "image/jpeg"
          ? "jpg"
          : mimeType === "image/webp"
            ? "webp"
            : "png";

      imageName =
        `dalbayob-edit.${extension}`;

    } else {
      /*
       * If the image is a normal URL, download it first.
       */

      const imageResponse =
        await fetch(image);

      if (!imageResponse.ok) {
        return res.status(502).json({
          error:
            "Could not download the source image"
        });
      }

      const imageBuffer =
        Buffer.from(
          await imageResponse.arrayBuffer()
        );

      const contentType =
        imageResponse.headers.get(
          "content-type"
        ) || "image/png";

      imageBlob = new Blob(
        [imageBuffer],
        { type: contentType }
      );
    }

    /*
     * ---------------------------------------------------------
     * 2. Upload image to ComfyUI
     * ---------------------------------------------------------
     */

    const uploadForm =
      new FormData();

    uploadForm.append(
      "image",
      imageBlob,
      imageName
    );

    uploadForm.append(
      "overwrite",
      "true"
    );

    const uploadResponse =
      await fetch(
        `${comfyUrl}/upload/image`,
        {
          method: "POST",
          headers: {
            "ngrok-skip-browser-warning":
              "true"
          },
          body: uploadForm
        }
      );

    if (!uploadResponse.ok) {
      const errorText =
        await uploadResponse.text();

      return res.status(502).json({
        error:
          "ComfyUI rejected the image upload",
        details: errorText
      });
    }

    const uploadResult =
      await uploadResponse.json();

    if (!uploadResult.name) {
      return res.status(502).json({
        error:
          "ComfyUI did not return an uploaded filename",
        details: uploadResult
      });
    }

    const uploadedFilename =
      uploadResult.name;

    const uploadedSubfolder =
      uploadResult.subfolder || "";

    /*
     * ---------------------------------------------------------
     * 3. Build the img2img workflow
     * ---------------------------------------------------------
     *
     * This uses the same:
     *
     *   qwen_3_4b.safetensors
     *   ae.safetensors
     *   z_image_turbo_bf16.safetensors
     *
     * setup as your working image generator.
     *
     * The difference is that the existing image is encoded
     * into the latent space before KSampler.
     */

    const workflow = {

      "1": {
        inputs: {
          image:
            uploadedFilename,
          upload:
            "image",
          subfolder:
            uploadedSubfolder,
          type:
            "input"
        },
        class_type:
          "LoadImage",
        _meta: {
          title:
            "Load Source Image"
        }
      },

      "2": {
        inputs: {
          clip_name:
            "qwen_3_4b.safetensors",
          type:
            "lumina2",
          device:
            "default"
        },
        class_type:
          "CLIPLoader",
        _meta: {
          title:
            "Load CLIP"
        }
      },

      "3": {
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

      "4": {
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

      "5": {
        inputs: {
          text:
            prompt,
          clip:
            ["2", 0]
        },
        class_type:
          "CLIPTextEncode",
        _meta: {
          title:
            "Edit Instruction"
        }
      },

      "6": {
        inputs: {
          pixels:
            ["1", 0],
          vae:
            ["3", 0]
        },
        class_type:
          "VAEEncode",
        _meta: {
          title:
            "Encode Source Image"
        }
      },

      "7": {
        inputs: {
          conditioning:
            ["5", 0]
        },
        class_type:
          "ConditioningZeroOut",
        _meta: {
          title:
            "Negative Conditioning"
        }
      },

      "8": {
        inputs: {
          shift:
            3,
          model:
            ["4", 0]
        },
        class_type:
          "ModelSamplingAuraFlow",
        _meta: {
          title:
            "Model Sampling"
        }
      },

      "9": {
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
           * Lower = stronger preservation.
           *
           * 0.45 is a good starting point for edits.
           */

          denoise:
            0.45,

          model:
            ["8", 0],

          positive:
            ["5", 0],

          negative:
            ["7", 0],

          latent_image:
            ["6", 0]
        },
        class_type:
          "KSampler",
        _meta: {
          title:
            "Image Edit Sampler"
        }
      },

      "10": {
        inputs: {
          samples:
            ["9", 0],
          vae:
            ["3", 0]
        },
        class_type:
          "VAEDecode",
        _meta: {
          title:
            "Decode Edited Image"
        }
      },

      "11": {
        inputs: {
          filename_prefix:
            "dalbayob-edit",
          images:
            ["10", 0]
        },
        class_type:
          "SaveImage",
        _meta: {
          title:
            "Save Edited Image"
        }
      }
    };

    /*
     * ---------------------------------------------------------
     * 4. Send workflow to ComfyUI
     * ---------------------------------------------------------
     */

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

    if (!promptResponse.ok) {
      const errorText =
        await promptResponse.text();

      return res.status(502).json({
        error:
          "ComfyUI rejected the edit workflow",
        details:
          errorText
      });
    }

    const promptResult =
      await promptResponse.json();

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

    /*
     * ---------------------------------------------------------
     * 5. Wait for ComfyUI
     * ---------------------------------------------------------
     */

    let output = null;

    const maxAttempts = 120;

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

      if (
        execution.status?.status_str ===
        "error"
      ) {
        return res.status(500).json({
          error:
            "ComfyUI failed while editing the image",
          details:
            execution.status
        });
      }

      if (
        execution.status?.completed !==
        true
      ) {
        continue;
      }

      if (
        execution.outputs?.["11"]?.images
          ?.length
      ) {
        output =
          execution.outputs["11"]
            .images[0];

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
     * ---------------------------------------------------------
     * 6. Download final image from ComfyUI
     * ---------------------------------------------------------
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

    /*
     * ---------------------------------------------------------
     * 7. Return edited image
     * ---------------------------------------------------------
     */

    return res.status(200).json({
      image:
        imageDataUrl,

      filename:
        filename,

      prompt_id:
        promptId
    });

  } catch (error) {

    console.error(
      "ComfyUI image editing error:",
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
