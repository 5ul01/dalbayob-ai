export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "No prompt provided" });
    }

    // Your local ComfyUI server
    const comfyUrl = "http://127.0.0.1:8188";

    // The workflow that we already proved works.
    const workflow = {
      "9": {
        "inputs": {
          "filename_prefix": "dalbayob",
          "images": ["57:8", 0]
        },
        "class_type": "SaveImage"
      },

      "57:30": {
        "inputs": {
          "clip_name": "qwen_3_4b.safetensors",
          "type": "lumina2",
          "device": "default"
        },
        "class_type": "CLIPLoader"
      },

      "57:29": {
        "inputs": {
          "vae_name": "ae.safetensors"
        },
        "class_type": "VAELoader"
      },

      "57:33": {
        "inputs": {
          "conditioning": ["57:27", 0]
        },
        "class_type": "ConditioningZeroOut"
      },

      "57:8": {
        "inputs": {
          "samples": ["57:3", 0],
          "vae": ["57:29", 0]
        },
        "class_type": "VAEDecode"
      },

      "57:28": {
        "inputs": {
          "unet_name": "z_image_turbo_bf16.safetensors",
          "weight_dtype": "default"
        },
        "class_type": "UNETLoader"
      },

      "57:27": {
        "inputs": {
          "text": prompt,
          "clip": ["57:30", 0]
        },
        "class_type": "CLIPTextEncode"
      },

      "57:13": {
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        },
        "class_type": "EmptySD3LatentImage"
      },

      "57:11": {
        "inputs": {
          "shift": 3,
          "model": ["57:28", 0]
        },
        "class_type": "ModelSamplingAuraFlow"
      },

      "57:3": {
        "inputs": {
          "seed": Math.floor(Math.random() * 1000000000000000),
          "steps": 8,
          "cfg": 1,
          "sampler_name": "res_multistep",
          "scheduler": "simple",
          "denoise": 1,
          "model": ["57:11", 0],
          "positive": ["57:27", 0],
          "negative": ["57:33", 0],
          "latent_image": ["57:13", 0]
        },
        "class_type": "KSampler"
      }
    };

    // Start generation
    const queueResponse = await fetch(`${comfyUrl}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: workflow
      })
    });

    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      return res.status(500).json({
        error: "ComfyUI rejected the request",
        details: errorText
      });
    }

    const queueData = await queueResponse.json();
    const promptId = queueData.prompt_id;

    if (!promptId) {
      return res.status(500).json({
        error: "ComfyUI did not return a prompt ID"
      });
    }

    // Wait for generation to finish
    let history = null;

    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const historyResponse = await fetch(
        `${comfyUrl}/history/${promptId}`
      );

      if (!historyResponse.ok) {
        continue;
      }

      const historyData = await historyResponse.json();

      if (historyData[promptId]) {
        const job = historyData[promptId];

        if (job.status && job.status.completed === true) {
          history = job;
          break;
        }

        if (
          job.status &&
          job.status.status_str === "error"
        ) {
          return res.status(500).json({
            error: "ComfyUI failed to generate the image",
            details: job.status
          });
        }
      }
    }

    if (!history) {
      return res.status(504).json({
        error: "Image generation timed out"
      });
    }

    // Find the generated image
    const output =
      history.outputs &&
      history.outputs["9"] &&
      history.outputs["9"].images &&
      history.outputs["9"].images[0];

    if (!output) {
      return res.status(500).json({
        error: "ComfyUI completed but returned no image"
      });
    }

    const imageUrl =
      `${comfyUrl}/view?` +
      `filename=${encodeURIComponent(output.filename)}` +
      `&subfolder=${encodeURIComponent(output.subfolder || "")}` +
      `&type=${encodeURIComponent(output.type || "output")}`;

    return res.status(200).json({
      image: imageUrl,
      filename: output.filename,
      prompt_id: promptId
    });

  } catch (error) {
    console.error("ComfyUI image generation error:", error);

    return res.status(500).json({
      error: "Image generation failed",
      details: error.message
    });
  }
}
