// bot.js - অ্যাডমিন প্রাইভেটে /addvideo দিলে ধাপে ধাপে
// টাইটেল/থাম্বনেইল/ভিডিও URL নিয়ে ডাটাবেজে সেভ করে, ভিডিওর প্রথম কয়েক
// সেকেন্ডের একটা প্রিভিউ ক্লিপ কেটে সেটা চ্যানেলে অটো-পোস্ট করে

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const TelegramBotModule = require("node-telegram-bot-api");
// CJS/ESM কম্প্যাটিবিলিটি ফিক্স (Render Node v24 environment এর জন্য)
const TelegramBot = TelegramBotModule.default || TelegramBotModule;

const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const { addVideo, getVideo } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBAPP_BASE_URL = process.env.WEBAPP_BASE_URL;
const PREMIUM_CONTACT = process.env.PREMIUM_CONTACT || "@SecretVault_BD";
const PREVIEW_SECONDS = Number(process.env.PREVIEW_SECONDS || 3); // ২-৪ সেকেন্ডের মধ্যে যেকোনো একটা মান দিতে পারেন
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("❌ .env ফাইলে BOT_TOKEN বসাও।");
  process.exit(1);
}

// ⬇️ পোলিং এর বদলে webhook ব্যবহার করা হচ্ছে — এতে Render এর deploy-overlap এর সময়
// একাধিক instance একসাথে getUpdates কল করার কারণে যে "409 Conflict" আসে, সেটা আর হবে না।
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
if (WEBAPP_BASE_URL) {
  const webhookUrl = `${WEBAPP_BASE_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  bot
    .setWebHook(webhookUrl)
    .then(() => console.log(`✅ Webhook সেট হয়েছে -> ${webhookUrl}`))
    .catch((err) => console.error("❌ Webhook সেট করতে সমস্যা:", err.message));
} else {
  console.error("❌ .env এ WEBAPP_BASE_URL সেট করা নেই, webhook সেট করা যাচ্ছে না।");
}
const userState = {}; // প্রতিটা ইউজারের /addvideo কথোপকথনের ধাপ ট্র্যাক করার জন্য

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

bot.onText(/\/addvideo/, (msg) => {
  const userId = msg.from.id;
  if (!isAdmin(userId)) {
    bot.sendMessage(msg.chat.id, "❌ তুমি এই কমান্ড ব্যবহার করার অনুমতিপ্রাপ্ত না।");
    return;
  }
  userState[userId] = { step: "title" };
  bot.sendMessage(msg.chat.id, "📌 ভিডিওর টাইটেল লিখো:");
});

bot.on("message", async (msg) => {
  const userId = msg.from.id;
  if (!userState[userId] || msg.text?.startsWith("/")) return;

  const state = userState[userId];

  if (state.step === "title") {
    state.title = msg.text.trim();
    state.step = "thumbnail";
    bot.sendMessage(msg.chat.id, "🖼️ থাম্বনেইল ইমেজের URL দাও:");
    return;
  }

  if (state.step === "thumbnail") {
    state.thumbnailUrl = msg.text.trim();
    state.step = "video";
    bot.sendMessage(msg.chat.id, "🎥 আসল ভিডিওর URL দাও:");
    return;
  }

  if (state.step === "video") {
    state.videoUrl = msg.text.trim();

    const processingMsg = await bot.sendMessage(
      msg.chat.id,
      "⏳ ভিডিও সেভ হচ্ছে এবং প্রিভিউ ক্লিপ তৈরি হচ্ছে, একটু অপেক্ষা করো..."
    );

    try {
      // PostgreSQL Async Support
      const videoId = await addVideo({
        title: state.title,
        thumbnailUrl: state.thumbnailUrl,
        videoUrl: state.videoUrl,
      });

      const posted = await postToChannel(videoId);

      if (posted) {
        bot.sendMessage(
          msg.chat.id,
          `✅ ভিডিও যোগ হয়েছে এবং প্রিভিউসহ চ্যানেলে পোস্ট হয়ে গেছে!\nVideo ID: \`${videoId}\``,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          msg.chat.id,
          `⚠️ ভিডিও ডাটাবেজে সেভ হয়েছে (Video ID: \`${videoId}\`), কিন্তু চ্যানেলে পোস্ট করতে ব্যর্থ হয়েছে। Render Logs চেক করো।`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      console.error("Error adding video:", error);
      bot.sendMessage(
        msg.chat.id,
        "❌ ভিডিও সেভ বা প্রিভিউ তৈরি করতে সমস্যা হয়েছে। কনসোল লগ চেক করো।"
      );
    } finally {
      bot.deleteMessage(msg.chat.id, processingMsg.message_id).catch(() => {});
    }

    delete userState[userId];
  }
});

// ---------- আসল ভিডিও URL থেকে প্রথম কয়েক সেকেন্ডের ছোট প্রিভিউ ক্লিপ বানানো ----------
function createPreviewClip(videoUrl, videoId) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(
      os.tmpdir(),
      `preview_${videoId}_${randomUUID()}.mp4`
    );

    console.log(`[preview] শুরু হচ্ছে -> videoId=${videoId}, source=${videoUrl}`);

    ffmpeg(videoUrl)
      .setStartTime(0)
      .duration(PREVIEW_SECONDS)
      .outputOptions([
        "-c:v libx264",
        "-c:a aac",
        "-preset veryfast",
        "-movflags +faststart",
      ])
      .on("start", (cmd) => console.log("[preview] ffmpeg command:", cmd))
      .on("stderr", (line) => console.log("[preview][ffmpeg stderr]", line))
      .on("error", (err) => {
        console.error(`[preview] ffmpeg ব্যর্থ হয়েছে -> videoId=${videoId}:`, err.message);
        reject(err);
      })
      .on("end", () => {
        console.log(`[preview] সফলভাবে তৈরি হয়েছে -> ${outputPath}`);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

async function postToChannel(videoId) {
  console.log(`[postToChannel] শুরু -> videoId=${videoId}, CHANNEL_ID=${CHANNEL_ID}`);

  const video = await getVideo(videoId);
  if (!video) {
    console.error("[postToChannel] Video not found for ID:", videoId);
    return;
  }

  // db.js থেকে PostgreSQL snake_case (video_url) অথবা camelCase (videoUrl) —
  // যেকোনো ফরম্যাটে আসতে পারে, তাই দুটোই চেক করা হচ্ছে
  const videoUrl = video.videoUrl || video.video_url;
  const title = video.title;

  console.log(`[postToChannel] video অবজেক্ট:`, JSON.stringify(video));

  if (!videoUrl) {
    console.error("[postToChannel] ❌ videoUrl খালি! DB থেকে সঠিক ফিল্ড আসছে না।");
    return;
  }

  if (!CHANNEL_ID) {
    console.error("[postToChannel] ❌ CHANNEL_ID .env এ সেট করা নেই! পোস্ট করা সম্ভব না।");
    return;
  }

  const directWebAppUrl = `https://t.me/norrcartonbot/noor?startapp=${videoId}`;

  // HTML parse mode ব্যবহার করা হচ্ছে Markdown এর বদলে — কারণ Markdown এ '_' '*' '['
  // এই চিহ্নগুলো থাকলে (যেমন @SecretVault_BD এর আন্ডারস্কোর) পার্সিং এরর হয়।
  // HTML মোডে শুধু <, >, & escape করলেই যথেষ্ট, তাই এটা অনেক বেশি নিরাপদ।
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const caption =
    `🎬 <b>${escapeHtml(title)}</b>\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `▶️  উপরে প্রিভিউ দেখুন\n` +
    `🎁  সম্পূর্ণ ভিডিও ১০০% ফ্রি\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `💎 Premium কনটেন্টের জন্য\n` +
    `👉 ${escapeHtml(PREMIUM_CONTACT)}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "▶️ Watch Full Video",
          url: directWebAppUrl,
        },
      ],
    ],
  };

  let previewPath = null;
  let posted = false;
  try {
    previewPath = await createPreviewClip(videoUrl, videoId);

    console.log("[postToChannel] sendVideo কল করা হচ্ছে...");
    await bot.sendVideo(CHANNEL_ID, previewPath, {
      caption,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
      supports_streaming: true,
    });
    console.log("[postToChannel] ✅ sendVideo সফল হয়েছে।");
    posted = true;
  } catch (e) {
    console.error(
      "[postToChannel] প্রিভিউ ক্লিপ পাঠাতে সমস্যা হয়েছে, ফলব্যাক টেক্সট পাঠানো হচ্ছে। কারণ:",
      e.message
    );
    // ফলব্যাক: প্রিভিউ ক্লিপ বানানো/পাঠানো সম্ভব না হলে অন্তত টেক্সট মেসেজ যাবে,
    // যাতে ভিডিওটা চ্যানেলে অনুপস্থিত না থাকে
    try {
      console.log("[postToChannel] fallback sendMessage কল করা হচ্ছে...");
      await bot.sendMessage(CHANNEL_ID, caption, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      console.log("[postToChannel] ✅ fallback sendMessage সফল হয়েছে।");
      posted = true;
    } catch (err2) {
      console.error("[postToChannel] ❌ fallback sendMessage ও ব্যর্থ হয়েছে:", err2.message);
    }
  } finally {
    if (previewPath) {
      fs.unlink(previewPath, () => {}); // টেম্প ফাইল পরিষ্কার করা
    }
  }

  return posted;
}

console.log("🤖 Admin bot running (webhook mode)...");

module.exports = { bot, WEBHOOK_PATH };