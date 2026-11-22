package app.vidshelf;

import android.graphics.Bitmap;
import android.media.MediaDataSource;
import android.media.MediaMetadataRetriever;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * MEGA 가 썸네일을 만들어 두지 않은 영상에서 한 장면을 뽑습니다.
 * 영상 전체를 받지 않고, 안드로이드 디코더가 실제로 읽는 부분(앞부분·색인)만 조각으로 받아 복호화합니다.
 */
class MegaFrame {

    /** 결과: 장면 이미지와 영상 정보 (모르면 0). */
    static class Result {
        Bitmap bitmap;
        double duration;
        int width, height;
    }

    /** MEGA 전송량 한도에 걸렸을 때. */
    static class QuotaException extends IOException {
        QuotaException(String m) { super(m); }
    }

    private static final int BLOCK = 512 * 1024;
    private static final int MAX_CACHED_BLOCKS = 16;      // 최대 8MB 메모리
    static final long BUDGET = 24L * 1024 * 1024;           // 영상 하나에 최대 24MB 까지만 받음

    /** 구간 요청으로 읽는 MEGA 파일. 받은 양이 한도를 넘으면 읽기를 멈춤. */
    static class Source extends MediaDataSource {
        final Mega.Link link;
        final Mega.Node node;
        long fetched;
        IOException failure;
        private final Map<Long, byte[]> cache = new LinkedHashMap<Long, byte[]>(16, .75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Long, byte[]> e) { return size() > MAX_CACHED_BLOCKS; }
        };

        Source(Mega.Link link, Mega.Node node) {
            this.link = link;
            this.node = node;
        }

        private byte[] block(long idx) throws IOException {
            byte[] b = cache.get(idx);
            if (b != null) return b;
            long start = idx * BLOCK, end = Math.min(start + BLOCK, node.size) - 1;
            int len = (int) (end - start + 1);
            if (fetched + len > BUDGET) throw new IOException("budget");
            b = new byte[len];
            try (InputStream in = Mega.open(link, node, start, end)) {
                int off = 0;
                while (off < len) {
                    int k = in.read(b, off, len - off);
                    if (k < 0) throw new IOException("MEGA 응답이 중간에 끊겼습니다");
                    off += k;
                }
            } catch (IOException e) {
                if (Mega.errorText(-17).equals(e.getMessage())) failure = new QuotaException(e.getMessage());
                else if (failure == null) failure = e;
                throw e;
            }
            fetched += len;
            cache.put(idx, b);
            return b;
        }

        @Override
        public synchronized int readAt(long position, byte[] buffer, int offset, int size) throws IOException {
            if (position >= node.size) return -1;
            size = (int) Math.min(size, node.size - position);
            int done = 0;
            while (done < size) {
                long p = position + done;
                byte[] b = block(p / BLOCK);
                int inBlock = (int) (p % BLOCK);
                int n = Math.min(size - done, b.length - inBlock);
                System.arraycopy(b, inBlock, buffer, offset + done, n);
                done += n;
            }
            return done;
        }

        @Override
        public long getSize() { return node.size; }

        @Override
        public void close() { cache.clear(); }
    }

    /** 장면을 뽑습니다. 실패하면 bitmap 이 null. 전송량 한도에 걸리면 QuotaException. */
    static Result grab(Mega.Link link, Mega.Node node) throws QuotaException {
        Result r = new Result();
        if (node.size <= 0) return r;
        Source src = new Source(link, node);
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(src);
            String d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            r.duration = d == null ? 0 : Long.parseLong(d) / 1000.0;
            int w = parse(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int h = parse(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            int rot = parse(mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            if (rot == 90 || rot == 270) { int t = w; w = h; h = t; }
            r.width = w;
            r.height = h;
            // 앞부분이라 받을 양이 적고, 검은 화면(인트로)은 피하는 지점
            double at = r.duration > 0 ? Math.min(r.duration * 0.1, 20) : 1;
            Bitmap b = null;
            try {
                b = mmr.getScaledFrameAtTime((long) (at * 1_000_000), MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 640, 640);
            } catch (Exception ignored) {
            }
            if (b == null && src.failure == null) {
                try { b = mmr.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 640, 640); } catch (Exception ignored) {}
            }
            r.bitmap = b;
        } catch (Exception ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
        if (src.failure instanceof QuotaException) {
            if (r.bitmap != null) r.bitmap.recycle();
            throw (QuotaException) src.failure;
        }
        return r;
    }

    private static int parse(String s) {
        try { return s == null ? 0 : Integer.parseInt(s.trim()); } catch (Exception e) { return 0; }
    }
}
