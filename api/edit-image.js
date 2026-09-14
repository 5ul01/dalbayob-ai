export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const comfyUrl = "https://phantom-smudge-voting.ngrok-free.dev";

  try {
    const body = req.body || {};

    /*
     * Accept several possible frontend field names so this endpoint
     * is easy to connect to the existing Dalbayob frontend.
     */
    const image =
      body.image ||
      body.imageData ||
      body.file ||
      (Array.isArray(body.images) ? body.images[0] : null);

    const prompt =
      body.prompt ||
      body.message ||
      body.instruction ||
      body.editPrompt ||
      "";

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "No image provided"
      });
    }

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "No edit instruction provided"
      });
    }

    /*
     * ------------------------------------------------------------
     * 1. Convert the incoming image into binary data
     * ------------------------------------------------------------
     *
     * The frontend can send:
     *
     * data:image/png;base64,AAAA...
     *
     * or:
     *
     * data:image/jpeg;base64,AAAA...
     *
     * or plain base64.
     */

    let imageBuffer;
    let mimeType = "image/png";
    let extension = "png";

    if (image.startsWith("data:")) {
      const match = image.match(
        /^data:([^;]+);base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image data"
        });
      }

      mimeType = match[1];
      const base64Data = match[2];

      if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
        extension = "jpg";
      } else if (mimeType === "image/webp") {
        extension = "webp";
      } else if (mimeType === "image/png") {
        extension = "png";
      } else {
        extension = "png";
      }

      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      /*
       * If the frontend supplied plain base64, accept it too.
       */
      try {
        imageBuffer = Buffer.from(image, "base64");
      } catch {
        return res.status(400).json({
          error: "Invalid base64 image"
        });
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({
        error: "Image data is empty"
      });
    }

    /*
     * ------------------------------------------------------------
     * 2. Upload the image to ComfyUI
     * ------------------------------------------------------------
     */

    const filename =
      `dalbayob_edit_${Date.now()}.${extension}`;

    const formData = new FormData();

    const blob = new Blob(
      [imageBuffer],
      { type: mimeType }
    );

    formData.append(
      "image",
      blob,
      filename
    );

    /*
     * ComfyUI can overwrite an existing filename. We use a unique
     * filename anyway, so this is safe.
     */
    formData.append("overwrite", "true");

    const uploadResponse = await fetch(
      `${comfyUrl}/upload/image`,
      {
        method: "POST",
        headers: {
          "ngrok-skip-browser-warning": "true"
        },
        body: formData
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();

      console.error(
        "ComfyUI image upload failed:",
        errorText
      );

      return res.status(502).json({
        error: "Could not upload image to ComfyUI",
        details: errorText
      });
    }

    const uploadResult = await uploadResponse.json();

    /*
     * ComfyUI normally returns:
     *
     * {
     *   name: "...",
     *   subfolder: "",
     *   type: "input"
     * }
     */

    const comfyFilename =
      uploadResult.name || filename;

    /*
     * ------------------------------------------------------------
     * 3. Build the EXACT working Qwen Image Edit workflow
     * ------------------------------------------------------------
     */

    const workflow = {
      "78": {
        inputs: {
          image: comfyFilename
        },
        class_type: "LoadImage",
        _meta: {
          title: "Load Image"
        }
      },

      "469": {
        inputs: {
          filename_prefix: "Qwen_Image_2509",
          format: "png",
          "format.bit_depth": "8-bit",
          "format.input_color_space": "sRGB",
          images: [
            "433:8",
            0
          ]
        },
        class_type: "SaveImageAdvanced",
        _meta: {
          title: "Save Image (Advanced)"
        }
      },

      "433:75": {
        inputs: {
          strength: 1,
          pre_cfg: false,
          model: [
            "433:66",
            0
          ]
        },
        class_type: "CFGNorm",
        _meta: {
          title: "CFGNorm"
        }
      },

      "433:39": {
        inputs: {
          vae_name: "qwen_image_vae.safetensors"
        },
        class_type: "VAELoader",
        _meta: {
          title: "Load VAE"
        }
      },

      "433:38": {
        inputs: {
          clip_name:
            "qwen_2.5_vl_7b_fp8_scaled.safetensors",
          type: "qwen_image",
          device: "default"
        },
        class_type: "CLIPLoader",
        _meta: {
          title: "Load CLIP"
        }
      },

      "433:37": {
        inputs: {
          unet_name:
            "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
          weight_dtype: "default"
        },
        class_type: "UNETLoader",
        _meta: {
          title: "Load Diffusion Model"
        }
      },

      /*
       * THIS is the actual editing prompt.
       *
       * Your ComfyUI test had:
       * "make background black"
       *
       * We replace that with the instruction sent
       * from Dalbayob AI.
       */
      "433:110": {
        inputs: {
          prompt: "",
          clip: [
            "433:38",
            0
          ],
          vae: [
            "433:39",
            0
          ],
          image1: [
            "433:117",
            0
          ]
        },
        class_type: "TextEncodeQwenImageEditPlus",
        _meta: {
          title: "TextEncodeQwenImageEditPlus"
        }
      },

      "433:66": {
        inputs: {
          shift: 3,
          model: [
            "433:440",
            0
          ]
        },
        class_type: "ModelSamplingAuraFlow",
        _meta: {
          title: "ModelSamplingAuraFlow"
        }
      },

      "433:111": {
        inputs: {
          /*
           * Dynamic user instruction.
           */
          prompt: prompt,

          clip: [
            "433:38",
            0
          ],

          vae: [
            "433:39",
            0
          ],

          image1: [
            "433:117",
            0
          ]
        },
        class_type: "TextEncodeQwenImageEditPlus",
        _meta: {
          title: "TextEncodeQwenImageEditPlus"
        }
      },

      "433:88": {
        inputs: {
          pixels: [
            "433:117",
            0
          ],
          vae: [
            "433:39",
            0
          ]
        },
        class_type: "VAEEncode",
        _meta: {
          title: "VAE Encode"
        }
      },

      "433:8": {
        inputs: {
          samples: [
            "433:3",
            0
          ],
          vae: [
            "433:39",
            0
          ]
        },
        class_type: "VAEDecode",
        _meta: {
          title: "VAE Decode"
        }
      },

      "433:89": {
        inputs: {
          lora_name:
            "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
          strength_model: 1,
          model: [
            "433:37",
            0
          ]
        },
        class_type: "LoraLoaderModelOnly",
        _meta: {
          title: "Load LoRA"
        }
      },

      "433:117": {
        inputs: {
          image: [
            "78",
            0
          ]
        },
        class_type: "FluxKontextImageScale",
        _meta: {
          title: "FluxKontextImageScale"
        }
      },

      "433:3": {
        inputs: {
          seed: Math.floor(
            Math.random() * 999999999999999
          ),

          steps: [
            "433:441",
            0
          ],

          cfg: [
            "433:442",
            0
          ],

          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1,

          model: [
            "433:75",
            0
          ],

          positive: [
            "433:111",
            0
          ],

          negative: [
            "433:110",
            0
          ],

          latent_image: [
            "433:88",
            0
          ]
        },

        class_type: "KSampler",

        _meta: {
          title: "KSampler"
        }
      },

      "433:436": {
        inputs: {
          value: 4
        },
        class_type: "PrimitiveInt",
        _meta: {
          title: "Stpes"
        }
      },

      "433:437": {
        inputs: {
          value: 1
        },
        class_type: "PrimitiveFloat",
        _meta: {
          title: "CFG"
        }
      },

      "433:438": {
        inputs: {
          value: 20
        },
        class_type: "PrimitiveInt",
        _meta: {
          title: "Steps"
        }
      },

      "433:439": {
        inputs: {
          value: 4
        },
        class_type: "PrimitiveFloat",
        _meta: {
          title: "CFG"
        }
      },

      "433:440": {
        inputs: {
          switch: [
            "433:443",
            0
          ],

          on_false: [
            "433:37",
            0
          ],

          on_true: [
            "433:89",
            0
          ]
        },

        class_type: "ComfySwitchNode",

        _meta: {
          title: "Switch (Model)"
        }
      },

      "433:441": {
        inputs: {
          switch: [
            "433:443",
            0
          ],

          on_false: [
            "433:438",
            0
          ],

          on_true: [
            "433:436",
            0
          ]
        },

        class_type: "ComfySwitchNode",

        _meta: {
          title: "Switch (Steps)"
        }
      },

      "433:442": {
        inputs: {
          switch: [
            "433:443",
            0
          ],

          on_false: [
            "433:439",
            0
          ],

          on_true: [
            "433:437",
            0
          ]
        },

        class_type: "ComfySwitchNode",

        _meta: {
          title: "Switch (CFG)"
        }
      },

      "433:443": {
        inputs: {
          value: true
        },

        class_type: "PrimitiveBoolean",

        _meta: {
          title: "Enable Lightning LoRA"
        }
      }
    };

    /*
     * ------------------------------------------------------------
     * 4. Queue the workflow
     * ------------------------------------------------------------
     */

    const promptResponse = await fetch(
      `${comfyUrl}/prompt`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        },

        body: JSON.stringify({
          prompt: workflow
        })
      }
    );

    if (!promptResponse.ok) {
      const errorText =
        await promptResponse.text();

      console.error(
        "ComfyUI rejected edit workflow:",
        errorText
      );

      return res.status(502).json({
        error: "ComfyUI rejected the editing workflow",
        details: errorText
      });
    }

    const promptResult =
      await promptResponse.json();

    if (!promptResult.prompt_id) {
      return res.status(502).json({
        error: "ComfyUI did not return a prompt ID",
        details: promptResult
      });
    }

    const promptId =
      promptResult.prompt_id;

    /*
     * ------------------------------------------------------------
     * 5. Wait for ComfyUI to finish
     * ------------------------------------------------------------
     */

    let output = null;

    const maxAttempts = 180;

    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt++
    ) {
      await new Promise(
        resolve => setTimeout(resolve, 1000)
      );

      const historyResponse =
        await fetch(
          `${comfyUrl}/history/${promptId}`,
          {
            headers: {
              "ngrok-skip-browser-warning": "true"
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
          details: execution.status,
          prompt_id: promptId
        });
      }

      /*
       * Not finished yet.
       */
      if (
        execution.status?.completed !== true
      ) {
        continue;
      }

      /*
       * Save Image Advanced node is 469.
       */
      if (
        execution.outputs?.["469"]?.images?.length
      ) {
        output =
          execution.outputs["469"].images[0];

        break;
      }

      /*
       * Fallback in case the output node is represented
       * differently by ComfyUI.
       */
      if (
        execution.outputs?.["433:8"]?.images?.length
      ) {
        output =
          execution.outputs["433:8"].images[0];

        break;
      }
    }

    if (!output) {
      return res.status(504).json({
        error:
          "ComfyUI timed out before returning the edited image",
        prompt_id: promptId
      });
    }

    /*
     * ------------------------------------------------------------
     * 6. Download the generated image from ComfyUI
     * ------------------------------------------------------------
     */

    const outputFilename =
      output.filename;

    const outputSubfolder =
      output.subfolder || "";

    const outputType =
      output.type || "output";

    const imageParams =
      new URLSearchParams({
        filename: outputFilename,
        subfolder: outputSubfolder,
        type: outputType
      });

    const imageResponse =
      await fetch(
        `${comfyUrl}/view?${imageParams.toString()}`,
        {
          headers: {
            "ngrok-skip-browser-warning": "true"
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
        details: errorText
      });
    }

    /*
     * ------------------------------------------------------------
     * 7. Convert the result to a data URL
     * ------------------------------------------------------------
     */

    const imageBufferResult =
      Buffer.from(
        await imageResponse.arrayBuffer()
      );

    const imageBase64 =
      imageBufferResult.toString("base64");

    const imageDataUrl =
      `data:image/png;base64,${imageBase64}`;

    /*
     * ------------------------------------------------------------
     * 8. Return the edited image
     * ------------------------------------------------------------
     */

    return res.status(200).json({
      image: imageDataUrl,
      filename: outputFilename,
      prompt_id: promptId,
      prompt
    });

  } catch (error) {
    console.error(
      "Dalbayob Qwen Image Edit error:",
      error
    );

    return res.status(500).json({
      error: "Image editing failed",
      details: error?.message || String(error)
    });
  }
}
