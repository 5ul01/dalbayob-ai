export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "No prompt provided"
      });
    }

    // Your existing ComfyUI tunnel
    const comfyUrl = "https://phantom-smudge-voting.ngrok-free.dev";

    /*
     * Z-Image Turbo TEXT-TO-IMAGE workflow.
     *
     * This follows the actual generation branch from
     * the workflow you exported from ComfyUI:
     *
     * 57:30 CLIP
     * 57:29 VAE
     * 57:28 UNET
     * 57:27 Prompt
     * 57:11 Model Sampling
     * 57:13 Empty Latent
     * 57:3  KSampler
     * 57:8  VAE Decode
     * 9    Save Image
     */

    const workflow = {
      "9": {
        inputs: {
          filename_prefix: "dalbayob-z-image",
          images: ["57:8", 0]
        },
        class_type: "SaveImage",
        _meta: {
          title: "Save Image"
        }
      },

      "57:30": {
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

      "57:29": {
        inputs: {
          vae_name: "ae.safetensors"
        },
        class_type: "VAELoader",
        _meta: {
          title: "Load VAE"
        }
      },

      "57:33": {
        inputs: {
          conditioning: ["57:27", 0]
        },
        class_type: "ConditioningZeroOut",
        _meta: {
          title: "Conditioning Zero Out"
        }
      },

      "57:8": {
        inputs: {
          samples: ["57:3", 0],
          vae: ["57:29", 0]
        },
        class_type: "VAEDecode",
        _meta: {
          title: "VAE Decode"
        }
      },

      "57:28": {
        inputs: {
          unet_name: "z_image_turbo_bf16.safetensors",
          weight_dtype: "default"
        },
        class_type: "UNETLoader",
        _meta: {
          title: "Load Diffusion Model"
        }
      },

      "57:27": {
        inputs: {
          text: prompt,
          clip: ["57:30", 0]
        },
        class_type: "CLIPTextEncode",
        _meta: {
          title: "CLIP Text Encode (Prompt)"
        }
      },

      "57:13": {
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1
        },
        class_type: "EmptySD3LatentImage",
        _meta: {
          title: "EmptySD3LatentImage"
        }
      },

      "57:11": {
        inputs: {
          shift: 3,
          model: ["57:28", 0]
        },
        class_type: "ModelSamplingAuraFlow",
        _meta: {
          title: "Model Sampling"
        }
      },

      "57:3": {
        inputs: {
          seed: Math.floor(Math.random() * 999999999999999),
          steps: 8,
          cfg: 1,
          sampler_name: "res_multistep",
          scheduler: "simple",
          denoise: 1,
          model: ["57:11", 0],
          positive: ["57:27", 0],
          negative: ["57:33", 0],
          latent_image: ["57:13", 0]
        },
        class_type: "KSampler",
        _meta: {
          title: "KSampler"
        }
      }
    };

    console.log("Dalbayob: sending image generation request to ComfyUI");

    /*
     * Queue the workflow
     */

    const promptResponse = await fetch(`${comfyUrl}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"
      },
      body: JSON.stringify({
        prompt: workflow
      })
    });

    if (!promptResponse.ok) {
      const errorText = await promptResponse.text();

      console.error(
        "ComfyUI rejected workflow:",
        errorText
      );

      return res.status(502).json({
        error: "ComfyUI rejected the workflow",
        details: errorText
      });
    }

    const promptResult = await promptResponse.json();

    console.log(
      "ComfyUI prompt result:",
      promptResult
    );

    if (!promptResult.prompt_id) {
      return res.status(502).json({
        error: "ComfyUI did not return a prompt ID",
        details: promptResult
      });
    }

    const promptId = promptResult.prompt_id;

    /*
     * Wait for ComfyUI.
     */

    let output = null;

    const maxAttempts = 180;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve =>
        setTimeout(resolve, 1000)
      );

      const historyResponse = await fetch(
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

      const history = await historyResponse.json();

      if (!history[promptId]) {
        continue;
      }

      const execution = history[promptId];

      /*
       * ComfyUI execution error
       */

      if (
        execution.status &&
        execution.status.status_str === "error"
      ) {
        console.error(
          "ComfyUI execution error:",
          execution.status
        );

        return res.status(500).json({
          error: "ComfyUI failed while generating the image",
          details: execution.status
        });
      }

      /*
       * Still processing
       */

      if (
        !execution.status ||
        execution.status.completed !== true
      ) {
        continue;
      }

      /*
       * Get the image saved by node 9.
       */

      if (
        execution.outputs &&
        execution.outputs["9"] &&
        execution.outputs["9"].images &&
        execution.outputs["9"].images.length > 0
      ) {
        output = execution.outputs["9"].images[0];
        break;
      }

      /*
       * If node 9 somehow isn't present, search all
       * output nodes for an image.
       */

      if (execution.outputs) {
        for (const nodeId of Object.keys(execution.outputs)) {
          const nodeOutput = execution.outputs[nodeId];

          if (
            nodeOutput &&
            Array.isArray(nodeOutput.images) &&
            nodeOutput.images.length > 0
          ) {
            output = nodeOutput.images[0];
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
        error: "ComfyUI timed out before returning an image",
        prompt_id: promptId
      });
    }

    /*
     * Retrieve the actual image from ComfyUI.
     */

    const filename = output.filename;
    const subfolder = output.subfolder || "";
    const type = output.type || "output";

    const imageParams = new URLSearchParams({
      filename,
      subfolder,
      type
    });

    const imageResponse = await fetch(
      `${comfyUrl}/view?${imageParams.toString()}`,
      {
        headers: {
          "ngrok-skip-browser-warning": "true"
        }
      }
    );

    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();

      console.error(
        "Could not retrieve ComfyUI image:",
        errorText
      );

      return res.status(502).json({
        error: "Could not retrieve generated image from ComfyUI",
        details: errorText
      });
    }

    /*
     * Convert image to a data URL so the browser doesn't
     * have to communicate directly with your ngrok tunnel.
     */

    const imageBuffer = Buffer.from(
      await imageResponse.arrayBuffer()
    );

    const imageBase64 =
      imageBuffer.toString("base64");

    const imageDataUrl =
      `data:image/png;base64,${imageBase64}`;

    console.log(
      "Dalbayob: image generation completed:",
      filename
    );

    return res.status(200).json({
      image: imageDataUrl,
      filename,
      prompt_id: promptId
    });

  } catch (error) {
    console.error(
      "ComfyUI image generation error:",
      error
    );

    return res.status(500).json({
      error: "Image generation failed",
      details: error.message
    });
  }
}
