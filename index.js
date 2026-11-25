import "dotenv/config";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import sharp from "sharp";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || process.env.SERVER_PORT || 10373;
const PHONE = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");
const STICKER_IMG = path.join(__dirname, "IMG-20261122-WA0043(7).jpg");
const AUDIO_OGG = path.join(__dirname, "audio.ogg");
const AUDIO_MP3 = path.join(__dirname, "audio.mp3");
const TRIGGER = "!stiker";

let sock;

// Halaman kecil di port panel, supaya status bisa dicek lewat browser
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot stiker WhatsApp berjalan. Kirim !stiker di chat WhatsApp.");
}).listen(PORT, "0.0.0.0", () => console.log(`HTTP di port ${PORT}`));

async function sendSticker(jid, quoted) {
  // Stiker WhatsApp harus WebP 512x512. Stiker tidak bisa membawa suara.
  const webp = await sharp(STICKER_IMG)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toBuffer();
  const stickerMsg = await sock.sendMessage(jid, { sticker: webp }, { quoted });

  // Suara dikirim sebagai VN yang membalas stiker itu, supaya tampil berkaitan
  const replyTo = stickerMsg || quoted;
  if (fs.existsSync(AUDIO_OGG)) {
    await sock.sendMessage(jid, { audio: fs.readFileSync(AUDIO_OGG), mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: replyTo });
  } else if (fs.existsSync(AUDIO_MP3)) {
    await sock.sendMessage(jid, { audio: fs.readFileSync(AUDIO_MP3), mimetype: "audio/mpeg", ptt: true }, { quoted: replyTo });
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });

  sock.ev.on("creds.update", saveCreds);

  if (!sock.authState.creds.registered) {
    if (!PHONE) {
      console.log("PHONE_NUMBER belum diisi di .env (format 62..., tanpa + dan tanpa 0 di depan).");
    } else {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PHONE);
          console.log("KODE PAIRING:", code);
          console.log("Masukkan di WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon.");
        } catch (e) {
          console.log("Gagal minta kode pairing:", e.message);
        }
      }, 3000);
    }
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") console.log("WhatsApp tersambung.");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("Perangkat dikeluarkan dari WhatsApp. Hapus folder auth lalu pairing ulang.");
        return;
      }
      console.log("Koneksi putus, mencoba lagi...");
      start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log("Pesan masuk, tipe:", type, "jumlah:", messages.length);
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      console.log("Isi pesan:", JSON.stringify(text), "dari:", msg.key.remoteJid);

      // Voice note yang kamu kirim sendiri (chat "Pesan untuk diri sendiri") disimpan jadi suara stiker
      if (msg.message.audioMessage && msg.key.fromMe) {
        try {
          const buf = await downloadMediaMessage(msg, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
          fs.writeFileSync(AUDIO_OGG, buf);
          await sock.sendMessage(msg.key.remoteJid, { text: "Suara disimpan. Sekarang !stiker akan mengirim stiker lalu suara ini." }, { quoted: msg });
          console.log("Voice note disimpan ke audio.ogg");
        } catch (e) {
          console.log("Gagal simpan voice note:", e.message);
        }
        continue;
      }
      if (text.trim().toLowerCase() !== TRIGGER) continue;
      try {
        await sendSticker(msg.key.remoteJid, msg);
      } catch (e) {
        console.log("Gagal kirim stiker:", e.message);
      }
    }
  });
}

start();
