// db.js - SQLite ডাটাবেজ (server.js এবং bot.js দুইটাই এটা ব্যবহার করবে)
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const db = new Database(path.join(__dirname, "data", "videos.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    thumbnail_url TEXT,
    video_url TEXT NOT NULL,
    wait_seconds INTEGER DEFAULT 45,
    views INTEGER DEFAULT 0,
    ad_views INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    video_id TEXT NOT NULL,
    ads_watched INTEGER DEFAULT 0,
    unlocked INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, video_id)
  );
`);

function addVideo({ title, thumbnailUrl, videoUrl, waitSeconds = 45 }) {
  const id = crypto.randomBytes(5).toString("hex");
  db.prepare(
    `INSERT INTO videos (id, title, thumbnail_url, video_url, wait_seconds) VALUES (?, ?, ?, ?, ?)`
  ).run(id, title, thumbnailUrl, videoUrl, waitSeconds);
  return id;
}

function getVideo(id) {
  return db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id);
}

function getOrCreateProgress(userId, videoId) {
  let row = db
    .prepare(`SELECT * FROM progress WHERE user_id = ? AND video_id = ?`)
    .get(userId, videoId);
  if (!row) {
    db.prepare(
      `INSERT INTO progress (user_id, video_id, ads_watched, unlocked) VALUES (?, ?, 0, 0)`
    ).run(userId, videoId);
    row = db
      .prepare(`SELECT * FROM progress WHERE user_id = ? AND video_id = ?`)
      .get(userId, videoId);
  }
  return row;
}

function markAdWatched(userId, videoId) {
  const progress = getOrCreateProgress(userId, videoId);
  const video = getVideo(videoId);

  const adsWatched = progress.ads_watched + 1;
  const unlocked = 1;

  db.prepare(
    `UPDATE progress SET ads_watched = ?, unlocked = ? WHERE user_id = ? AND video_id = ?`
  ).run(adsWatched, unlocked, userId, videoId);

  if (!progress.unlocked) {
    db.prepare(`UPDATE videos SET views = views + 1 WHERE id = ?`).run(videoId);
  }
  db.prepare(`UPDATE videos SET ad_views = ad_views + 1 WHERE id = ?`).run(videoId);

  return getOrCreateProgress(userId, videoId);
}

function markWaitFinished(userId, videoId) {
  const progress = getOrCreateProgress(userId, videoId);
  if (!progress.unlocked) {
    db.prepare(
      `UPDATE progress SET unlocked = 1 WHERE user_id = ? AND video_id = ?`
    ).run(userId, videoId);
    db.prepare(`UPDATE videos SET views = views + 1 WHERE id = ?`).run(videoId);
  }
  return getOrCreateProgress(userId, videoId);
}

function markBonusAd(userId, videoId) {
  db.prepare(
    `UPDATE progress SET ads_watched = ads_watched + 1 WHERE user_id = ? AND video_id = ?`
  ).run(userId, videoId);
  db.prepare(`UPDATE videos SET ad_views = ad_views + 1 WHERE id = ?`).run(videoId);
  return getOrCreateProgress(userId, videoId);
}

module.exports = {
  db,
  addVideo,
  getVideo,
  getOrCreateProgress,
  markAdWatched,
  markWaitFinished,
  markBonusAd,
};
