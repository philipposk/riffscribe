#!/usr/bin/env node
/**
 * Local audio fetcher for Riffscribe.
 *
 * The studio itself is a static page — a browser cannot pull audio out of
 * YouTube (it is cross-origin, and the media URLs are signed), and doing it from
 * a hosted server would get the server's address blocked in short order. So this
 * runs on your own machine: you start it, paste a link into the studio, and the
 * audio comes back over localhost. Nothing is uploaded anywhere.
 *
 *   node local/fetch-server.mjs
 *
 * Needs yt-dlp and ffmpeg:
 *   brew install yt-dlp ffmpeg
 *
 * Only you can reach it: it binds to 127.0.0.1 and answers a fixed set of
 * origins. It is a convenience for your own practice material — respect the
 * terms of whatever site you point it at, and other people's copyright.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.RIFFSCRIBE_FETCH_PORT || 7749);
const ALLOWED = new Set([
  "https://riffscribe.6x7.gr",
  "http://localhost:3000",
  "http://localhost:3011",
  "http://127.0.0.1:3000",
]);
const MAX_SECONDS = Number(process.env.RIFFSCRIBE_MAX_SECONDS || 900);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  // the studio sets COEP, so cross-origin replies must opt in
  res.setHeader("cross-origin-resource-policy", "cross-origin");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d) => process.stdout.write(d));
    p.stderr.on("data", (d) => { err += d; process.stderr.write(d); });
    p.on("error", (e) =>
      reject(new Error(e.code === "ENOENT" ? `${cmd} is not installed — brew install ${cmd}` : e.message))
    );
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `${cmd} failed`))));
  });
}

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "riffscribe-fetch" }));
  }
  if (url.pathname !== "/fetch") return res.writeHead(404).end("not found");

  const target = url.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "pass ?url= an http(s) link" }));
  }

  const dir = await mkdtemp(join(tmpdir(), "riffscribe-"));
  try {
    console.log(`\n→ fetching ${target}`);
    await run("yt-dlp", [
      "--no-playlist",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--match-filter", `duration < ${MAX_SECONDS}`,
      "--output", join(dir, "audio.%(ext)s"),
      target,
    ]);

    const files = await readdir(dir);
    const audio = files.find((f) => f.endsWith(".mp3"));
    if (!audio) throw new Error("nothing was downloaded — the link may be a playlist, private, or too long");

    const bytes = await readFile(join(dir, audio));
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": bytes.length,
      "content-disposition": `inline; filename="${audio}"`,
    });
    res.end(bytes);
    console.log(`← sent ${(bytes.length / 1e6).toFixed(1)} MB`);
  } catch (e) {
    console.error("✗", e.message);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Riffscribe local fetcher on http://127.0.0.1:${PORT}`);
  console.log("Paste a link into the studio's “or paste a link” box and it will come through here.");
});
