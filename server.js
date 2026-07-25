require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const {
  getVideo,
  getOrCreateProgress,
  markAdWatched,
  markWaitFinished,
  markBonusAd,
} = require("./db");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ফলব্যাক ডেমো ডাটা (যখন DB তে ভিডিও পাওয়া যাবে না)
const DEMO_VIDEO = {
  id: "demo",
  title: "Sample Video Player",
  thumbnail_url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&q=80",
  video_url: "https://vjs.zencdn.net/v/oceans.mp4",
  wait_seconds: 15,
};

function progressPayload(progress, video) {
  const payload = {
    ads_watched: progress ? Number(progress.ads_watched) : 0,
    unlocked: progress ? Boolean(progress.unlocked) : false,
  };
  if (payload.unlocked) payload.video_url = video.video_url;
  return payload;
}

// ১. ভিডিওর তথ্য পাঠানোর API
app.get("/api/video/:id", async (req, res) => {
  try {
    const video = await getVideo(req.params.id);

    if (video) {
      // ✅ ডাটাবেজের ডায়নামিক ভিডিও
      return res.json({
        id: video.id,
        title: video.title,
        thumbnail_url: video.thumbnail_url,
        wait_seconds: video.wait_seconds || 15,
      });
    }

    // ⚠️ DB তে ডাটা না থাকলে ফলব্যাক ডেমো ডাটা
    return res.json({
      id: DEMO_VIDEO.id,
      title: DEMO_VIDEO.title,
      thumbnail_url: DEMO_VIDEO.thumbnail_url,
      wait_seconds: DEMO_VIDEO.wait_seconds,
    });
  } catch (err) {
    console.error("API /video error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ২. ইউজারের প্রোগ্রেস চেক করার API
app.get("/api/progress/:id", async (req, res) => {
  try {
    const userId = req.query.user_id || 123456;
    const video = (await getVideo(req.params.id)) || DEMO_VIDEO;

    if (video.id === "demo") {
      return res.json({ ads_watched: 0, unlocked: false });
    }

    const progress = await getOrCreateProgress(Number(userId), req.params.id);
    res.json(progressPayload(progress, video));
  } catch (err) {
    console.error("API /progress error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ৩. Skip Wait (অ্যাড দেখে আনলক) API
app.post("/api/skip-wait/:id", async (req, res) => {
  try {
    const userId = req.body.user_id || 123456;
    const video = (await getVideo(req.params.id)) || DEMO_VIDEO;

    if (video.id === "demo") {
      return res.json({ unlocked: true, video_url: DEMO_VIDEO.video_url });
    }

    const progress = await markAdWatched(Number(userId), req.params.id);
    res.json(progressPayload(progress, video));
  } catch (err) {
    console.error("API /skip-wait error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ৪. টাইমার শেষ হলে আনলক করার API
app.post("/api/wait-finished/:id", async (req, res) => {
  try {
    const userId = req.body.user_id || 123456;
    const video = (await getVideo(req.params.id)) || DEMO_VIDEO;

    if (video.id === "demo") {
      return res.json({ unlocked: true, video_url: DEMO_VIDEO.video_url });
    }

    const progress = await markWaitFinished(Number(userId), req.params.id);
    res.json(progressPayload(progress, video));
  } catch (err) {
    console.error("API /wait-finished error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ৫. বোনাস সাপোর্ট অ্যাড API
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