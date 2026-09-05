export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "No prompt provided" });
    }

    const response = await fetch(
      "https://gen.pollinations.ai/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.POLLINATIONS_API_KEY}`
        },
        body: JSON.stringify({
          prompt,
          model: "zimage",
          size: "1024x1024",
          n: 1,
          response_format: "url"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json({
      image: data.data[0].url
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Image generation failed"
    });
  }
}
