// db.js - PostgreSQL ডাটাবেজ কনফিগারেশন
const { Pool } = require("pg");
const crypto = require("crypto");
require("dotenv").config();

// Render / External PG Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ১. ডাটাবেজে টেবিল তৈরি করার ফাংশন
async function initDb() {
  const queryText = `
    CREATE TABLE IF NOT EXISTS videos (
      id VARCHAR(50) PRIMARY KEY,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      video_url TEXT NOT NULL,
      wait_seconds INTEGER DEFAULT 45,
      views INTEGER DEFAULT 0,
      ad_views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS progress (
      user_id BIGINT NOT NULL,
      video_id VARCHAR(50) NOT NULL,
      ads_watched INTEGER DEFAULT 0,
      unlocked INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, video_id)
    );
  `;
  try {
    await pool.query(queryText);
    console.log("✅ PostgreSQL টেবিলসমূহ সফলভাবে প্রস্তুত হয়েছে।");
  } catch (err) {
    console.error("❌ টেবিল তৈরিতে সমস্যা হয়েছে:", err);
  }
}

// অ্যাপ রান হওয়ার সাথে সাথে টেবিলগুলো চেক/তৈরি করবে
initDb();

// ২. ভিডিও যোগ করা
async function addVideo({ title, thumbnailUrl, videoUrl, waitSeconds = 45 }) {
  const id = crypto.randomBytes(5).toString("hex");
  const text = `
    INSERT INTO videos (id, title, thumbnail_url, video_url, wait_seconds) 
    VALUES ($1, $2, $3, $4, $5) 
    RETURNING id;
  `;
  const values = [id, title, thumbnailUrl, videoUrl, waitSeconds];
  const res = await pool.query(text, values);
  return res.rows[0].id;
}

// ৩. ভিডিওর তথ্য নেওয়া
async function getVideo(id) {
  const text = `SELECT * FROM videos WHERE id = $1`;
  const res = await pool.query(text, [id]);
  return res.rows[0] || null;
}

// ৪. ইউজার প্রোগ্রেস চেক/তৈরি করা (ON CONFLICT ব্যবহার করে সহজে)
async function getOrCreateProgress(userId, videoId) {
  const text = `
    INSERT INTO progress (user_id, video_id, ads_watched, unlocked) 
    VALUES ($1, $2, 0, 0)
    ON CONFLICT (user_id, video_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING *;
  `;
  const res = await pool.query(text, [userId, videoId]);
  return res.rows[0];
}

// ৫. স্কিপ অ্যাড দেখে আনলক করা
async function markAdWatched(userId, videoId) {
  const progress = await getOrCreateProgress(userId, videoId);

  const updateProgressText = `
    UPDATE progress 
    SET ads_watched = ads_watched + 1, unlocked = 1 
    WHERE user_id = $1 AND video_id = $2 
    RETURNING *;
  `;
  const res = await pool.query(updateProgressText, [userId, videoId]);

  if (!progress.unlocked) {
    await pool.query(`UPDATE videos SET views = views + 1 WHERE id = $1`, [videoId]);
  }
  await pool.query(`UPDATE videos SET ad_views = ad_views + 1 WHERE id = $1`, [videoId]);

  return res.rows[0];
}

// ৬. টাইমার শেষ হলে আনলক করা
async function markWaitFinished(userId, videoId) {
  const progress = await getOrCreateProgress(userId, videoId);

  if (!progress.unlocked) {
    await pool.query(
      `UPDATE progress SET unlocked = 1 WHERE user_id = $1 AND video_id = $2`,
      [userId, videoId]
    );
    await pool.query(`UPDATE videos SET views = views + 1 WHERE id = $1`, [videoId]);
  }

  return await getOrCreateProgress(userId, videoId);
}

// ৭. বোনাস অ্যাড দেখা
async function markBonusAd(userId, videoId) {
  await pool.query(
    `UPDATE progress SET ads_watched = ads_watched + 1 WHERE user_id = $1 AND video_id = $2`,
    [userId, videoId]
  );
  await pool.query(`UPDATE videos SET ad_views = ad_views + 1 WHERE id = $1`, [videoId]);

  return await getOrCreateProgress(userId, videoId);
}

module.exports = {
  pool,
  addVideo,
  getVideo,
  getOrCreateProgress,
  markAdWatched,
  markWaitFinished,
  markBonusAd,
};