#!/usr/bin/env python3
"""VidShelf - 가벼운 셀프호스팅 영상 라이브러리.

Python 표준 라이브러리 + ffmpeg/ffprobe 만 사용합니다 (Termux/Android, Linux, macOS).
    python3 server.py               # http://127.0.0.1:8899
    python3 server.py --lan         # 같은 Wi-Fi 의 다른 기기에서도 접속
"""
import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
DATA_DIR = os.path.expanduser(os.environ.get("VIDSHELF_DATA", "~/.vidshelf"))
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")
DB_PATH = os.path.join(DATA_DIR, "library.db")

VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".flv",
              ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".3gp", ".ogv", ".vob"}
# 브라우저가 대체로 직접 재생 가능한 컨테이너 (나머지는 자동으로 호환 모드)
DIRECT_EXTS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".ogv", ".3gp"}
DIRECT_VCODECS = {"h264", "vp8", "vp9", "av1", "hevc", "theora"}
N_FRAMES = 8          # 영상마다 만드는 미리보기 프레임 수 (0번이 대표 이미지)
THUMB_WIDTH = 480

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


# ---------------------------------------------------------------- database
class DB:
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                size INTEGER, mtime REAL,
                duration REAL DEFAULT 0, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
                vcodec TEXT, acodec TEXT, bitrate INTEGER DEFAULT 0, fps REAL DEFAULT 0,
                added_at REAL, rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0,
                play_count INTEGER DEFAULT 0, last_played REAL, resume_pos REAL DEFAULT 0,
                details TEXT DEFAULT '', thumbs INTEGER DEFAULT 0, missing INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS performers (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS video_tags (
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (video_id, tag_id));
            CREATE TABLE IF NOT EXISTS video_performers (
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                performer_id INTEGER REFERENCES performers(id) ON DELETE CASCADE,
                PRIMARY KEY (video_id, performer_id));
            CREATE TABLE IF NOT EXISTS markers (
                id INTEGER PRIMARY KEY,
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                seconds REAL NOT NULL, title TEXT NOT NULL DEFAULT '');
            """)
            self.conn.commit()

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        rows = self.q(sql, args)
        return rows[0] if rows else None

    def x(self, sql, args=()):
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur

    def get_setting(self, key, default=None):
        r = self.one("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(r["value"]) if r else default

    def set_setting(self, key, value):
        self.x("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value)))


db = None


# ---------------------------------------------------------------- media helpers
def probe(path):
    """ffprobe 로 길이/해상도/코덱 정보를 읽습니다."""
    info = {"duration": 0, "width": 0, "height": 0, "vcodec": None, "acodec": None, "bitrate": 0, "fps": 0}
    if not FFPROBE:
        return info
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, timeout=60).stdout
        data = json.loads(out or b"{}")
    except Exception:
        return info
    fmt = data.get("format", {})
    info["duration"] = float(fmt.get("duration") or 0)
    info["bitrate"] = int(fmt.get("bit_rate") or 0)
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and not info["vcodec"] and s.get("disposition", {}).get("attached_pic") != 1:
            info["vcodec"] = s.get("codec_name")
            info["width"] = int(s.get("width") or 0)
            info["height"] = int(s.get("height") or 0)
            try:
                n, d = (s.get("avg_frame_rate") or "0/1").split("/")
                info["fps"] = round(float(n) / float(d), 2) if float(d) else 0
            except Exception:
                pass
            if not info["duration"]:
                info["duration"] = float(s.get("duration") or 0)
        elif s.get("codec_type") == "audio" and not info["acodec"]:
            info["acodec"] = s.get("codec_name")
    return info


def thumb_path(vid, n):
    return os.path.join(THUMB_DIR, str(vid), f"{n}.jpg")


def make_thumbs(video):
    """영상 전체 구간에서 N_FRAMES 장의 프레임을 뽑아 미리보기로 저장."""
    if not FFMPEG:
        return 0
    d = os.path.join(THUMB_DIR, str(video["id"]))
    os.makedirs(d, exist_ok=True)
    dur = video["duration"] or 0
    made = 0
    for i in range(N_FRAMES):
        # 0번(대표 이미지)은 20% 지점, 나머지는 고르게 분포
        frac = 0.2 if i == 0 else (i - 0.5) / (N_FRAMES - 1)
        t = dur * frac if dur > 1 else 0
        out = os.path.join(d, f"{i}.jpg")
        cmd = [FFMPEG, "-nostdin", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", video["path"],
               "-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "5", out]
        try:
            subprocess.run(cmd, capture_output=True, timeout=120)
        except Exception:
            pass
        if os.path.exists(out) and os.path.getsize(out) > 0:
            made += 1
        elif i == 0:
            # 짧은 영상 등에서 실패하면 첫 프레임으로 재시도
            subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", video["path"], "-frames:v", "1",
                            "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "5", out], capture_output=True, timeout=120)
            made += 1 if os.path.exists(out) else 0
    return made


# ---------------------------------------------------------------- background jobs
class Jobs:
    def __init__(self):
        self.q = queue.Queue()
        self.state = {"scanning": False, "scan_found": 0, "scan_new": 0, "scan_current": "",
                      "thumb_pending": 0, "thumb_current": "", "last_scan": None, "error": None}
        self.lock = threading.Lock()
        threading.Thread(target=self._thumb_worker, daemon=True).start()

    def status(self):
        with self.lock:
            s = dict(self.state)
        s["thumb_pending"] = self.q.qsize() + (1 if s["thumb_current"] else 0)
        return s

    def queue_thumbs(self, vid):
        self.q.put(vid)

    def _thumb_worker(self):
        while True:
            vid = self.q.get()
            try:
                v = db.one("SELECT * FROM videos WHERE id=?", (vid,))
                if v and os.path.exists(v["path"]):
                    with self.lock:
                        self.state["thumb_current"] = v["title"]
                    n = make_thumbs(v)
                    db.x("UPDATE videos SET thumbs=? WHERE id=?", (n, vid))
            except Exception:
                traceback.print_exc()
            finally:
                with self.lock:
                    self.state["thumb_current"] = ""

    def start_scan(self):
        with self.lock:
            if self.state["scanning"]:
                return False
            self.state.update(scanning=True, scan_found=0, scan_new=0, error=None)
        threading.Thread(target=self._scan, daemon=True).start()
        return True

    def _scan(self):
        try:
            roots = db.get_setting("library_paths", [])
            seen = set()
            for root in roots:
                for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
                    dirnames[:] = [d for d in dirnames if not d.startswith(".")]
                    for fn in filenames:
                        if os.path.splitext(fn)[1].lower() not in VIDEO_EXTS or fn.startswith("."):
                            continue
                        path = os.path.join(dirpath, fn)
                        seen.add(path)
                        with self.lock:
                            self.state["scan_found"] += 1
                            self.state["scan_current"] = fn
                        self._index_file(path)
            # 라이브러리에서 사라진 파일 표시
            for v in db.q("SELECT id, path FROM videos"):
                missing = 0 if (v["path"] in seen or os.path.exists(v["path"])) else 1
                db.x("UPDATE videos SET missing=? WHERE id=?", (missing, v["id"]))
        except Exception as e:
            traceback.print_exc()
            with self.lock:
                self.state["error"] = str(e)
        finally:
            with self.lock:
                self.state.update(scanning=False, scan_current="", last_scan=time.time())

    def _index_file(self, path):
        try:
            st = os.stat(path)
        except OSError:
            return
        row = db.one("SELECT id, size, mtime, thumbs FROM videos WHERE path=?", (path,))
        if row and row["size"] == st.st_size and abs((row["mtime"] or 0) - st.st_mtime) < 1:
            if not row["thumbs"]:
                self.queue_thumbs(row["id"])
            return
        info = probe(path)
        if row:
            db.x("""UPDATE videos SET size=?, mtime=?, duration=?, width=?, height=?, vcodec=?, acodec=?,
                    bitrate=?, fps=?, missing=0 WHERE id=?""",
                 (st.st_size, st.st_mtime, info["duration"], info["width"], info["height"], info["vcodec"],
                  info["acodec"], info["bitrate"], info["fps"], row["id"]))
            vid = row["id"]
        else:
            title = os.path.splitext(os.path.basename(path))[0]
            cur = db.x("""INSERT INTO videos(path,title,size,mtime,duration,width,height,vcodec,acodec,bitrate,fps,added_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (path, title, st.st_size, st.st_mtime, info["duration"], info["width"], info["height"],
                        info["vcodec"], info["acodec"], info["bitrate"], info["fps"], time.time()))
            vid = cur.lastrowid
            with self.lock:
                self.state["scan_new"] += 1
        self.queue_thumbs(vid)


jobs = None


# ---------------------------------------------------------------- query helpers
SORTS = {
    "added": "v.added_at", "title": "v.title COLLATE NOCASE", "duration": "v.duration",
    "size": "v.size", "rating": "v.rating", "plays": "v.play_count", "played": "v.last_played",
    "mtime": "v.mtime", "resolution": "v.height", "random": None,
}


def video_summary(v):
    return {k: v[k] for k in ("id", "title", "duration", "width", "height", "size", "rating", "favorite",
                              "play_count", "thumbs", "missing", "resume_pos", "added_at")}


def list_videos(params):
    where, args = ["1=1"], []
    q = (params.get("q") or "").strip()
    if q:
        for word in q.split():
            like = f"%{word}%"
            where.append("""(v.title LIKE ? OR v.path LIKE ? OR v.details LIKE ?
                OR EXISTS (SELECT 1 FROM video_tags vt JOIN tags t ON t.id=vt.tag_id WHERE vt.video_id=v.id AND t.name LIKE ?)
                OR EXISTS (SELECT 1 FROM video_performers vp JOIN performers p ON p.id=vp.performer_id WHERE vp.video_id=v.id AND p.name LIKE ?))""")
            args += [like] * 5
    for tid in params.get("tag_list", []):
        where.append("EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id=v.id AND vt.tag_id=?)")
        args.append(int(tid))
    for pid in params.get("performer_list", []):
        where.append("EXISTS (SELECT 1 FROM video_performers vp WHERE vp.video_id=v.id AND vp.performer_id=?)")
        args.append(int(pid))
    if params.get("fav") == "1":
        where.append("v.favorite=1")
    if params.get("unwatched") == "1":
        where.append("v.play_count=0")
    if params.get("missing") == "1":
        where.append("v.missing=1")
    else:
        where.append("v.missing=0")
    if params.get("min_rating"):
        where.append("v.rating>=?")
        args.append(int(params["min_rating"]))
    sort = params.get("sort") or "added"
    order = "ASC" if params.get("order") == "asc" else "DESC"
    page = max(1, int(params.get("page") or 1))
    per = min(200, max(1, int(params.get("per") or 40)))
    wsql = " AND ".join(where)
    total = db.one(f"SELECT COUNT(*) c FROM videos v WHERE {wsql}", args)["c"]
    if sort == "random":
        seed = int(params.get("seed") or 1) % 1000003
        order_sql = f"((v.id * 2654435761 + {seed}) % 1000003)"
    else:
        order_sql = f"{SORTS.get(sort, 'v.added_at')} {order}, v.id {order}"
    rows = db.q(f"SELECT v.* FROM videos v WHERE {wsql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
                args + [per, (page - 1) * per])
    return {"total": total, "page": page, "per": per, "items": [video_summary(r) for r in rows]}


def video_detail(vid):
    v = db.one("SELECT * FROM videos WHERE id=?", (vid,))
    if not v:
        return None
    v["tags"] = db.q("SELECT t.id, t.name FROM tags t JOIN video_tags vt ON vt.tag_id=t.id WHERE vt.video_id=? ORDER BY t.name", (vid,))
    v["performers"] = db.q("SELECT p.id, p.name FROM performers p JOIN video_performers vp ON vp.performer_id=p.id WHERE vp.video_id=? ORDER BY p.name", (vid,))
    v["markers"] = db.q("SELECT id, seconds, title FROM markers WHERE video_id=? ORDER BY seconds", (vid,))
    ext = os.path.splitext(v["path"])[1].lower()
    v["direct_play"] = ext in DIRECT_EXTS and (v["vcodec"] or "h264") in DIRECT_VCODECS
    v["filename"] = os.path.basename(v["path"])
    v["folder"] = os.path.dirname(v["path"])
    return v


def set_links(vid, table, link_table, col, names):
    clean = []
    for n in names:
        n = " ".join(str(n).split())[:80]
        if n and n.lower() not in [c.lower() for c in clean]:
            clean.append(n)
    with db.lock:
        db.conn.execute(f"DELETE FROM {link_table} WHERE video_id=?", (vid,))
        for n in clean:
            db.conn.execute(f"INSERT OR IGNORE INTO {table}(name) VALUES(?)", (n,))
            rid = db.conn.execute(f"SELECT id FROM {table} WHERE name=?", (n,)).fetchone()[0]
            db.conn.execute(f"INSERT OR IGNORE INTO {link_table}(video_id,{col}) VALUES(?,?)", (vid, rid))
        db.conn.commit()


def list_entities(table, link_table, col):
    return db.q(f"""SELECT e.id, e.name, COUNT(v.id) AS count,
                    (SELECT l2.video_id FROM {link_table} l2 JOIN videos v2 ON v2.id=l2.video_id
                      WHERE l2.{col}=e.id AND v2.thumbs>0 AND v2.missing=0 ORDER BY v2.rating DESC, v2.added_at DESC LIMIT 1) AS cover
                    FROM {table} e
                    LEFT JOIN {link_table} l ON l.{col}=e.id
                    LEFT JOIN videos v ON v.id=l.video_id AND v.missing=0
                    GROUP BY e.id ORDER BY e.name COLLATE NOCASE""")


def browse_dirs(path):
    home = os.path.expanduser("~")
    if not path:
        cands = [os.path.join(home, "storage", "shared"), "/storage/emulated/0", "/sdcard",
                 os.path.join(home, "storage"), home, "/"]
        seen, out = set(), []
        for c in cands:
            if os.path.isdir(c):
                rp = os.path.realpath(c)
                if rp not in seen:
                    seen.add(rp)
                    out.append({"name": c, "path": c})
        return {"path": "", "parent": None, "dirs": out}
    path = os.path.abspath(path)
    dirs = []
    try:
        for e in sorted(os.scandir(path), key=lambda e: e.name.lower()):
            if e.name.startswith("."):
                continue
            try:
                if e.is_dir():
                    dirs.append({"name": e.name, "path": e.path})
            except OSError:
                pass
    except OSError as e:
        return {"path": path, "parent": os.path.dirname(path), "dirs": [], "error": str(e)}
    parent = os.path.dirname(path)
    return {"path": path, "parent": parent if parent != path else "", "dirs": dirs}


def default_library_suggestions():
    home = os.path.expanduser("~")
    base = os.path.join(home, "storage", "shared")
    names = ["Movies", "DCIM", "Download", "Videos", "Pictures"]
    out = [os.path.join(base, n) for n in names if os.path.isdir(os.path.join(base, n))]
    for n in ["Videos", "Movies", "Downloads"]:
        p = os.path.join(home, n)
        if os.path.isdir(p):
            out.append(p)
    return out


# ---------------------------------------------------------------- auth
def password_hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100_000).hex()


def auth_token():
    ph = db.get_setting("password_hash")
    if not ph:
        return None
    return hmac.new(db.get_setting("secret").encode(), ph.encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "VidShelf/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("VIDSHELF_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- responses
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, msg):
        self.send_json({"error": msg}, status)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n) or b"{}")

    def send_file(self, path, ctype=None, cache=True):
        try:
            st = os.stat(path)
        except OSError:
            return self.send_error_json(404, "not found")
        ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
        size = st.st_size
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        status = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                if start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-cache")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # -- auth
    def authed(self):
        tok = auth_token()
        if not tok:
            return True
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return "vs_auth" in c and hmac.compare_digest(c["vs_auth"].value, tok)

    # -- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PATCH(self):
        self.route("PATCH")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
        params = {k: v[-1] for k, v in parse_qs(url.query).items()}
        params["tag_list"] = parse_qs(url.query).get("tag", [])
        params["performer_list"] = parse_qs(url.query).get("performer", [])
        try:
            if path.startswith("/api/"):
                if path not in ("/api/login", "/api/auth") and not self.authed():
                    return self.send_error_json(401, "login required")
                return self.api(method, path[5:], params)
            if path.startswith("/media/") or path.startswith("/thumbs/") or path.startswith("/transcode/"):
                if not self.authed():
                    return self.send_error_json(401, "login required")
                if path.startswith("/media/"):
                    return self.media(int(path.split("/")[2]))
                if path.startswith("/transcode/"):
                    return self.transcode(int(path.split("/")[2]), params)
                _, _, vid, name = path.split("/")
                n = int(name.split(".")[0])
                return self.send_file(thumb_path(int(vid), n), "image/jpeg", cache=("v" in params))
            # static
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            full = os.path.realpath(os.path.join(STATIC_DIR, rel))
            if not full.startswith(os.path.realpath(STATIC_DIR)) or not os.path.isfile(full):
                full = os.path.join(STATIC_DIR, "index.html")
            return self.send_file(full, cache=False)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as e:
            self.send_error_json(400, str(e))
        except Exception as e:
            traceback.print_exc()
            try:
                self.send_error_json(500, str(e))
            except Exception:
                pass

    def media(self, vid):
        v = db.one("SELECT path FROM videos WHERE id=?", (vid,))
        if not v:
            return self.send_error_json(404, "not found")
        ext = os.path.splitext(v["path"])[1].lower()
        ctype = {".mkv": "video/webm", ".mov": "video/mp4", ".m4v": "video/mp4",
                 ".3gp": "video/mp4"}.get(ext)  # mkv 를 webm 으로 알리면 Chrome 이 대부분 재생
        self.send_file(v["path"], ctype)

    def transcode(self, vid, params):
        """브라우저가 직접 못 여는 영상을 ffmpeg 로 실시간 변환 (조각 MP4 스트림)."""
        v = db.one("SELECT * FROM videos WHERE id=?", (vid,))
        if not v or not FFMPEG:
            return self.send_error_json(404, "not available")
        t = max(0.0, float(params.get("t") or 0))
        max_h = int(params.get("h") or 720)
        copy_video = v["vcodec"] == "h264" and params.get("force") != "1"
        cmd = [FFMPEG, "-nostdin", "-v", "error", "-ss", f"{t:.2f}", "-i", v["path"], "-map", "0:v:0", "-map", "0:a:0?"]
        if copy_video:
            cmd += ["-c:v", "copy"]
        else:
            cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "25",
                    "-vf", f"scale=-2:'min({max_h},ih)'", "-pix_fmt", "yuv420p"]
        cmd += ["-c:a", "aac", "-b:a", "128k", "-ac", "2",
                "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            while True:
                chunk = proc.stdout.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            proc.kill()
            proc.wait()

    def api(self, method, path, params):
        parts = [p for p in path.split("/") if p]
        P = lambda *a: tuple(parts) == a  # noqa: E731

        # ---- auth
        if P("auth"):
            return self.send_json({"required": bool(auth_token()), "ok": self.authed()})
        if P("login") and method == "POST":
            body = self.read_json()
            ph = db.get_setting("password_hash")
            if ph and hmac.compare_digest(password_hash(body.get("password", ""), db.get_setting("salt")), ph):
                self.send_response(200)
                self.send_header("Set-Cookie", f"vs_auth={auth_token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "11")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                return
            return self.send_error_json(403, "비밀번호가 틀렸습니다")

        # ---- videos
        if P("videos") and method == "GET":
            return self.send_json(list_videos(params))
        if len(parts) >= 2 and parts[0] == "videos":
            vid = int(parts[1])
            if len(parts) == 2:
                if method == "GET":
                    v = video_detail(vid)
                    return self.send_json(v) if v else self.send_error_json(404, "not found")
                if method == "PATCH":
                    body = self.read_json()
                    fields = {k: body[k] for k in ("title", "rating", "favorite", "details") if k in body}
                    if "rating" in fields:
                        fields["rating"] = max(0, min(5, int(fields["rating"])))
                    if "favorite" in fields:
                        fields["favorite"] = 1 if fields["favorite"] else 0
                    if fields:
                        db.x(f"UPDATE videos SET {', '.join(k + '=?' for k in fields)} WHERE id=?",
                             list(fields.values()) + [vid])
                    if "tags" in body:
                        set_links(vid, "tags", "video_tags", "tag_id", body["tags"])
                    if "performers" in body:
                        set_links(vid, "performers", "video_performers", "performer_id", body["performers"])
                    return self.send_json(video_detail(vid))
                if method == "DELETE":
                    v = db.one("SELECT path FROM videos WHERE id=?", (vid,))
                    if v and params.get("file") == "1" and os.path.exists(v["path"]):
                        os.remove(v["path"])
                    db.x("DELETE FROM videos WHERE id=?", (vid,))
                    shutil.rmtree(os.path.join(THUMB_DIR, str(vid)), ignore_errors=True)
                    return self.send_json({"ok": True})
            action = parts[2] if len(parts) > 2 else ""
            if action == "play" and method == "POST":
                db.x("UPDATE videos SET play_count=play_count+1, last_played=? WHERE id=?", (time.time(), vid))
                return self.send_json({"ok": True})
            if action == "progress" and method == "POST":
                db.x("UPDATE videos SET resume_pos=? WHERE id=?", (float(self.read_json().get("pos") or 0), vid))
                return self.send_json({"ok": True})
            if action == "thumbs" and method == "POST":
                jobs.queue_thumbs(vid)
                return self.send_json({"ok": True})
            if action == "markers" and method == "POST":
                body = self.read_json()
                db.x("INSERT INTO markers(video_id, seconds, title) VALUES(?,?,?)",
                     (vid, float(body.get("seconds") or 0), str(body.get("title") or "")[:200]))
                return self.send_json(video_detail(vid)["markers"])
        if len(parts) == 2 and parts[0] == "markers" and method == "DELETE":
            db.x("DELETE FROM markers WHERE id=?", (int(parts[1]),))
            return self.send_json({"ok": True})

        # ---- tags / performers
        for name, table, link, col in (("tags", "tags", "video_tags", "tag_id"),
                                       ("performers", "performers", "video_performers", "performer_id")):
            if P(name) and method == "GET":
                return self.send_json(list_entities(table, link, col))
            if len(parts) == 2 and parts[0] == name:
                eid = int(parts[1])
                if method == "GET":
                    e = db.one(f"SELECT id, name FROM {table} WHERE id=?", (eid,))
                    return self.send_json(e) if e else self.send_error_json(404, "not found")
                if method == "PATCH":
                    new = " ".join(str(self.read_json().get("name", "")).split())
                    if not new:
                        raise ValueError("이름이 비어 있습니다")
                    other = db.one(f"SELECT id FROM {table} WHERE name=? AND id<>?", (new, eid))
                    if other:  # 같은 이름이 있으면 병합
                        db.x(f"INSERT OR IGNORE INTO {link}(video_id,{col}) SELECT video_id, ? FROM {link} WHERE {col}=?",
                             (other["id"], eid))
                        db.x(f"DELETE FROM {table} WHERE id=?", (eid,))
                        return self.send_json({"id": other["id"], "merged": True})
                    db.x(f"UPDATE {table} SET name=? WHERE id=?", (new, eid))
                    return self.send_json({"id": eid})
                if method == "DELETE":
                    db.x(f"DELETE FROM {table} WHERE id=?", (eid,))
                    return self.send_json({"ok": True})

        # ---- library / settings
        if P("settings"):
            if method == "PUT":
                body = self.read_json()
                if "library_paths" in body:
                    paths = []
                    for p in body["library_paths"]:
                        p = os.path.abspath(os.path.expanduser(str(p).strip()))
                        if p and p not in paths:
                            paths.append(p)
                    db.set_setting("library_paths", paths)
                if "password" in body:
                    pw = body["password"] or ""
                    if pw:
                        salt = secrets.token_hex(8)
                        db.set_setting("salt", salt)
                        db.set_setting("password_hash", password_hash(pw, salt))
                    else:
                        db.x("DELETE FROM settings WHERE key IN ('password_hash','salt')")
            paths = db.get_setting("library_paths", [])
            return self.send_json({
                "library_paths": [{"path": p, "exists": os.path.isdir(p)} for p in paths],
                "suggestions": [p for p in default_library_suggestions() if p not in paths],
                "password_set": bool(db.get_setting("password_hash")),
                "data_dir": DATA_DIR, "ffmpeg": bool(FFMPEG), "ffprobe": bool(FFPROBE),
            })
        if P("browse"):
            return self.send_json(browse_dirs(params.get("path", "")))
        if P("scan") and method == "POST":
            started = jobs.start_scan()
            return self.send_json({"started": started})
        if P("status"):
            s = jobs.status()
            s["counts"] = db.one("""SELECT COUNT(*) total, COALESCE(SUM(size),0) bytes, COALESCE(SUM(duration),0) seconds,
                                    SUM(missing) missing, SUM(favorite) favorites FROM videos""")
            return self.send_json(s)
        if P("cleanup") and method == "POST":
            ids = [r["id"] for r in db.q("SELECT id FROM videos WHERE missing=1")]
            for vid in ids:
                db.x("DELETE FROM videos WHERE id=?", (vid,))
                shutil.rmtree(os.path.join(THUMB_DIR, str(vid)), ignore_errors=True)
            db.x("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM video_tags)")
            db.x("DELETE FROM performers WHERE id NOT IN (SELECT performer_id FROM video_performers)")
            return self.send_json({"removed": len(ids)})
        if P("random"):
            r = db.one("SELECT id FROM videos WHERE missing=0 ORDER BY RANDOM() LIMIT 1")
            return self.send_json(r or {})
        return self.send_error_json(404, "unknown endpoint")


def main():
    global db, jobs
    ap = argparse.ArgumentParser(description="VidShelf video library")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("VIDSHELF_PORT", 8899)))
    ap.add_argument("--lan", action="store_true", help="0.0.0.0 에서 대기 (같은 네트워크의 다른 기기 접속 허용)")
    ap.add_argument("--no-scan", action="store_true", help="시작할 때 자동 스캔하지 않기")
    a = ap.parse_args()
    os.makedirs(THUMB_DIR, exist_ok=True)
    db = DB(DB_PATH)
    if not db.get_setting("secret"):
        db.set_setting("secret", secrets.token_hex(32))
    jobs = Jobs()
    if not FFMPEG or not FFPROBE:
        print("경고: ffmpeg/ffprobe 를 찾을 수 없습니다. 썸네일과 영상 정보가 만들어지지 않습니다.", file=sys.stderr)
    if db.get_setting("library_paths") and not a.no_scan:
        jobs.start_scan()
    host = "0.0.0.0" if a.lan else a.host
    httpd = ThreadingHTTPServer((host, a.port), Handler)
    httpd.daemon_threads = True
    print(f"VidShelf 실행 중 → http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{a.port}")
    print(f"데이터 폴더: {DATA_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")


if __name__ == "__main__":
    main()
