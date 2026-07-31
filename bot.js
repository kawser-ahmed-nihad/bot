require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const TelegramBotModule = require("node-telegram-bot-api");
const TelegramBot = TelegramBotModule.default || TelegramBotModule;

const { addVideo, getVideo } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBAPP_BASE_URL = process.env.WEBAPP_BASE_URL;
const PREMIUM_CONTACT = process.env.PREMIUM_CONTACT || "@SecretVault_BD";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("❌ .env ফাইলে BOT_TOKEN বসাও।");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
if (WEBAPP_BASE_URL) {
  const webhookUrl = `${WEBAPP_BASE_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  bot
    .setWebHook(webhookUrl)
    .then(() => console.log(`✅ Webhook সেট হয়েছে -> ${webhookUrl}`))
    .catch((err) => console.error("❌ Webhook সেট করতে সমস্যা:", err.message));
}

const userState = {};

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
    bot.sendMessage(
      msg.chat.id,
      "🎥 আসল ভিডিওটি এই চ্যাটে **Upload / Forward** করো (অথবা File ID পাঠাও):"
    );
    return;
  }

  if (state.step === "video") {
    // যদি ফাইল/ভিডিও সরাসরি আপলোড করা হয়
    if (msg.video) {
      state.fileId = msg.video.file_id;
    } else if (msg.document && msg.document.mime_type?.startsWith("video/")) {
      state.fileId = msg.document.file_id;
    } else if (msg.text) {
      state.fileId = msg.text.trim();
    } else {
      bot.sendMessage(msg.chat.id, "❌ অনুগ্রহ করে একটি ভিডিও ফাইল আপলোড বা ফরওয়ার্ড করুন।");
      return;
    }

    const processingMsg = await bot.sendMessage(
      msg.chat.id,
      "⏳ ভিডিও ডাটাবেজে সেভ হচ্ছে এবং চ্যানেলে পোস্ট করা হচ্ছে..."
    );

    try {
      // DataBase এ URL এর বদলে fileId সেভ হবে
      const videoId = await addVideo({
        title: state.title,
        thumbnailUrl: state.thumbnailUrl,
        videoUrl: state.fileId, // file_id stored as videoUrl
      });

      const posted = await postToChannel(videoId, state.fileId, state.title, state.thumbnailUrl);

      if (posted) {
        bot.sendMessage(
          msg.chat.id,
          `✅ ভিডিও সফলভাবে যোগ হয়েছে!\nVideo ID: \`${videoId}\``,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          msg.chat.id,
          `⚠️ ভিডিও সেভ হয়েছে (ID: \`${videoId}\`), কিন্তু চ্যানেলে পোস্ট ব্যর্থ হয়েছে।`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      console.error("Error adding video:", error);
      bot.sendMessage(msg.chat.id, "❌ ভিডিও সেভ করতে সমস্যা হয়েছে।");
    } finally {
      bot.deleteMessage(msg.chat.id, processingMsg.message_id).catch(() => {});
    }

    delete userState[userId];
  }
});

// ---------- প্রাইভেট চ্যানেলে পোস্ট করা ----------
async function postToChannel(videoId, fileId, title, thumbnailUrl) {
  if (!CHANNEL_ID) return false;

  const directWebAppUrl = `https://t.me/norrcartonbot/noor?startapp=${videoId}`;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const caption =
    `🎬 <b>${escapeHtml(title)}</b>\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎁 সম্পূর্ণ ভিডিও ইনবক্সে পেতে নিচের বাটনে চাপ দিন\n` +
    `⚡ ২ ঘণ্টার জন্য দেখার সুযোগ পাবেন\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `💎 Premium কনটেন্টের জন্য\n` +
    `👉 ${escapeHtml(PREMIUM_CONTACT)}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "▶️ Get Full Video",
          url: directWebAppUrl,
        },
      ],
    ],
  };

  try {
    // থাম্বনেইল ছবি থাকলে ফটো হিসেবে চ্যানেলে যাবে
    if (thumbnailUrl) {
      await bot.sendPhoto(CHANNEL_ID, thumbnailUrl, {
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    } else {
      await bot.sendMessage(CHANNEL_ID, caption, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    }
    return true;
  } catch (e) {
    console.error("[postToChannel] Failed:", e.message);
    return false;
  }
}

// ---------- ইউজারের ইনবক্সে ভিডিও সেন্ড করা ও ২ ঘণ্টা পর ডিলিট ----------
async function sendVideoToUser(userId, videoId) {
  const video = await getVideo(videoId);
  if (!video) throw new Error("Video not found");

  const fileId = video.videoUrl || video.video_url;
  const title = video.title;

  // protect_content: true দিয়ে ভিডিও পাঠানো (ডাউনলোড/ফরওয়ার্ড ব্লক)
  const sentMsg = await bot.sendVideo(userId, fileId, {
    protect_content: true,
    caption: `🎬 <b>${title}</b>\n\n⚠️ এই ভিডিওটি ২ ঘণ্টার জন্য আপনার ইনবক্সে থাকবে। ২ ঘণ্টা পর স্বয়ংক্রিয়ভাবে ডিলিট হয়ে যাবে।`,
    parse_mode: "HTML",
  });

  // ২ ঘণ্টা (৭২০০০ মি.সে.) পর ডিলিট করার টাইমার
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  setTimeout(async () => {
    try {
      await bot.deleteMessage(userId, sentMsg.message_id);
      await bot.sendMessage(
        userId,
        `⌛ "${title}" ভিডিওটির ২ ঘণ্টার সময়সীমা শেষ হওয়ায় ইনবক্স থেকে মুছে ফেলা হয়েছে।`
      );
    } catch (err) {
      console.error("Message delete failed:", err.message);
    }
  }, TWO_HOURS);

  return true;
}

console.log("🤖 Admin bot running (webhook mode)...");

module.exports = { bot, WEBHOOK_PATH, sendVideoToUser };