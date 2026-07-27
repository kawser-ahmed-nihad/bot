require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const {
  getVideo,
  markBonusAd,
} = require("./db");

const app = express();
require("./bot"); // 👈 এই লাইনটি যোগ করুন
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ফলব্যাক ডেমো ডাটা (যখন DB তে ভিডিও পাওয়া যাবে না)
const DEMO_VIDEO = {
  id: "demo",
  title: "Sample Video Player",
  thumbnail_url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&q=80",
  video_url: "https://vjs.zencdn.net/v/oceans.mp4",
};

// ১. ভিডিওর তথ্য পাঠানোর API — সরাসরি video_url সহ, কোনো wait/unlock গেট নেই
app.get("/api/video/:id", async (req, res) => {
  try {
    const video = await getVideo(req.params.id);

    if (video) {
      // ✅ ডাটাবেজের ডায়নামিক ভিডিও (video_url সহ) — মূল কনটেন্ট সবসময় সরাসরি অ্যাক্সেসযোগ্য
      return res.json({
        id: video.id,
        title: video.title,
        thumbnail_url: video.thumbnail_url,
        video_url: video.video_url,
      });
    }

    // ⚠️ DB তে ডাটা না থাকলে ফলব্যাক ডেমো ডাটা
    return res.json({
      id: DEMO_VIDEO.id,
      title: DEMO_VIDEO.title,
      thumbnail_url: DEMO_VIDEO.thumbnail_url,
      video_url: DEMO_VIDEO.video_url,
    });
  } catch (err) {
    console.error("API /video error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ২. বোনাস সাপোর্ট অ্যাড API — সম্পূর্ণ ঐচ্ছিক, মূল ভিডিওর সাথে সম্পর্কহীন
app.post("/api/bonus-ad/:id", async (req, res) => {
  const userId = req.body.user_id || 123456;
  try {
    if (req.params.id !== "demo") {
      await markBonusAd(Number(userId), req.params.id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

// Mini App পেজ রাউটিং
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