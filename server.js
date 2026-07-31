require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const { getVideo, markBonusAd } = require("./db");

const app = express();
const { bot, WEBHOOK_PATH, sendVideoToUser } = require("./bot");

app.use(cors());
app.use(express.json());

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.use(express.static(path.join(__dirname, "public")));

// ১. ভিডিও ইনফো এপিআই
app.get("/api/video/:id", async (req, res) => {
  try {
    const video = await getVideo(req.params.id);
    if (video) {
      return res.json({
        id: video.id,
        title: video.title,
        thumbnail_url: video.thumbnail_url,
      });
    }
    return res.status(404).json({ error: "Video not found" });
  } catch (err) {
    console.error("API /video error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ২. অ্যাড দেখা শেষ হলে ভিডিও ইউজারকে ডেলিভারি দেওয়ার API
app.post("/api/send-video", async (req, res) => {
  const { user_id, video_id, ads_completed } = req.body;

  if (!ads_completed || ads_completed < 2) {
    return res.status(400).json({
      success: false,
      message: "ভিডিও পেতে হলে ২টি অ্যাড সম্পূর্ণ দেখতে হবে!",
    });
  }

  try {
    await sendVideoToUser(user_id, video_id);
    res.json({
      success: true,
      message: "ভিডিওটি আপনার টেলিগ্রাম ইনবক্সে পাঠানো হয়েছে!",
    });
  } catch (e) {
    console.error("Send video error:", e);
    res.status(500).json({
      success: false,
      message: "ভিডিও পাঠাতে ব্যর্থ হয়েছে। নিশ্চিত করুন আপনি বটটি স্টার্ট করেছেন।",
    });
  }
});

app.get("/video/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "video.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "video.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});