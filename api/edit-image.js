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

    const comfyUrl =
      "https://phantom-smudge-voting.ngrok-free.dev";

    /*
     * ---------------------------------------------------------
     * 1. Upload the source image to ComfyUI
     * ---------------------------------------------------------
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
        [Buffer.from(base64Data, "base64")],
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
            sourceResponse.headers.get("content-type") ||
            "image/png"
        }
      );
    }

    const extension =
      imageBlob.type === "image/jpeg"
        ? "jpg"
        : imageBlob.type === "image/webp"
          ? "webp"
          : "png";

    const uploadName =
      `dalbayob-source-${Date.now()}.${extension}`;

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
      return res.status(502).json({
        error: "ComfyUI rejected the source image upload",
        details: uploadText
      });
    }

    let uploadResult;

    try {
      uploadResult =
        JSON.parse(uploadText);
    } catch {
      return res.status(502).json({
        error: "ComfyUI returned invalid upload data",
        details: uploadText
      });
    }

    const uploadedFilename =
      uploadResult.name;

    const uploadedSubfolder =
      uploadResult.subfolder || "";

    if (!uploadedFilename) {
      return res.status(502).json({
        error: "ComfyUI did not return an uploaded filename",
        details: uploadResult
      });
    }

    /*
     * ---------------------------------------------------------
     * 2. Build a VERY explicit editing instruction
     * ---------------------------------------------------------
     */

    const editPrompt = `
EDIT THE EXISTING IMAGE.

USER REQUEST:
${prompt}

IMPORTANT EDITING RULES:

Only make the change requested by the user.

Preserve the existing:
- character identity
- face
- eyes
- ears
- fur
- body
- proportions
- pose
- hands
- legs
- clothing shape
- clothing material
- clothing design
- background
- environment
- camera angle
- framing
- composition
- image quality

Do NOT redesign the character.

Do NOT create a new character.

Do NOT change unrelated clothing.

Do NOT change the background unless the user specifically asks for it.

If the user asks for a color change, change the color of ONLY the requested object while preserving its exact shape, texture and position.

If the user asks to change the jacket, modify ONLY the jacket.

The final image should look like the original image with the requested modification applied.
`.trim();

    /*
     * ---------------------------------------------------------
     * 3. ComfyUI img2img workflow
     * ---------------------------------------------------------
     */

    const workflow = {
      "1": {
        inputs: {
          image: uploadedFilename,
          upload: "image"
        },
        class_type: "LoadImage",
        _meta: {
          title: "Load Source Image"
        }
      },

      "2": {
        inputs: {
          clip_name: "qwen_3_4b.safetensors",
          type: "lumina2",
          device: "default"
        },
        class_type: "CLIPLoader",
        _meta: {
          title: "Load CLIP"
        }
      },

      "3": {
        inputs: {
          vae_name: "ae.safetensors"
        },
        class_type: "VAELoader",
        _meta: {
          title: "Load VAE"
        }
      },

      "4": {
        inputs: {
          unet_name:
            "z_image_turbo_bf16.safetensors",
          weight_dtype: "default"
        },
        class_type: "UNETLoader",
        _meta: {
          title: "Load Diffusion Model"
        }
      },

      "5": {
        inputs: {
          text: editPrompt,
          clip: ["2", 0]
        },
        class_type: "CLIPTextEncode",
        _meta: {
          title: "Edit Instruction"
        }
      },

      "6": {
        inputs: {
          pixels: ["1", 0],
          vae: ["3", 0]
        },
        class_type: "VAEEncode",
        _meta: {
          title: "Encode Source Image"
        }
      },

      "7": {
        inputs: {
          conditioning: ["5", 0]
        },
        class_type: "ConditioningZeroOut",
        _meta: {
          title: "Negative Conditioning"
        }
      },

      "8": {
        inputs: {
          shift: 3,
          model: ["4", 0]
        },
        class_type: "ModelSamplingAuraFlow",
        _meta: {
          title: "Model Sampling"
        }
      },

      "9": {
        inputs: {
          seed:
            Math.floor(
              Math.random() *
              999999999999999
            ),

          steps: 8,

          cfg: 1,

          sampler_name:
            "res_multistep",

          scheduler:
            "simple",

          /*
           * LOW DENOISE = preserve the source.
           */
          denoise: 0.25,

          model: ["8", 0],

          positive: ["5", 0],

          negative: ["7", 0],

          latent_image: ["6", 0]
        },

        class_type: "KSampler",

        _meta: {
          title: "Image Edit Sampler"
        }
      },

      "10": {
        inputs: {
          samples: ["9", 0],
          vae: ["3", 0]
        },

        class_type: "VAEDecode",

        _meta: {
          title: "Decode Edited Image"
        }
      },

      "11": {
        inputs: {
          filename_prefix:
            "dalbayob-edit",

          images: ["10", 0]
        },

        class_type: "SaveImage",

        _meta: {
          title: "Save Edited Image"
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
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "ngrok-skip-browser-warning":
              "true"
          },

          body: JSON.stringify({
            prompt: workflow
          })
        }
      );

    const promptText =
      await promptResponse.text();

    if (!promptResponse.ok) {
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
        JSON.parse(promptText);
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

    /*
     * ---------------------------------------------------------
     * 5. Wait for ComfyUI
     * ---------------------------------------------------------
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
        execution.status?.completed !== true
      ) {
        continue;
      }

      if (
        execution.outputs?.["11"]?.images
          ?.length
      ) {
        output =
          execution.outputs["11"].images[0];

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
     * 6. Download the actual PNG
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

      filename,

      prompt_id:
        promptId
    });

  } catch (error) {
    console.error(
      "Dalbayob image edit error:",
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
