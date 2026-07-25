// bot.py এর Node.js ভার্সন - অ্যাডমিন প্রাইভেটে /addvideo দিলে ধাপে ধাপে
// টাইটেল/থাম্বনেইল/ভিডিও URL নিয়ে ডাটাবেজে সেভ করে এবং চ্যানেলে অটো-পোস্ট করে

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { addVideo, getVideo } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBAPP_BASE_URL = process.env.WEBAPP_BASE_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("❌ .env ফাইলে BOT_TOKEN বসাও।");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userState = {}; // প্রতিটা ইউজারের /addvideo কথোপকথনের ধাপ ট্র্যাক করার জন্য

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

bot.onText(/\/addvideo/, (msg) => {
  const userId = msg.from.id;
  console.log("তোমার Telegram ID:", userId);
  console.log("ADMIN_IDS এ যা আছে:", ADMIN_IDS);
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

    const videoId = addVideo({
      title: state.title,
      thumbnailUrl: state.thumbnailUrl,
      videoUrl: state.videoUrl,
    });

    await postToChannel(videoId);

    bot.sendMessage(
      msg.chat.id,
      `✅ ভিডিও যোগ হয়েছে এবং চ্যানেলে পোস্ট হয়ে গেছে!\nVideo ID: \`${videoId}\``,
      { parse_mode: "Markdown" }
    );
    delete userState[userId];
  }
});

async function postToChannel(videoId) {
  const video = getVideo(videoId);
  const directWebAppUrl = `https://t.me/norrcartonbot/noor?startapp=${videoId}`;

  const messageText =
    `🎬 *${video.title}*\n\n` +
    `🔥 ফ্রি ফুল ভিডিও দেখতে নিচের বাটনে চাপো\n` +
    `👇 অ্যাড দেখলে সাথে সাথে খুলে যাবে`;

  try {
    // sendPhoto এর বদলে sendMessage
    await bot.sendMessage(CHANNEL_ID, messageText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎬 Watch Video",
              url: directWebAppUrl,
            },
          ],
        ],
      },
    });
  } catch (e) {
    console.error("Error posting to channel:", e.message);
  }
}

console.log("🤖 Admin bot running...");
