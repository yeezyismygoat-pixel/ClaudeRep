package app.vidshelf;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 출연자 정보(본명·생년월일·키)를 한국어 위키백과와 위키데이터에서 찾습니다.
 * 그룹 이름이 있으면 그 그룹이 언급된 문서만 받아들여 동명이인을 거릅니다.
 */
public class PersonLookup {

    public static class Result {
        public String realName, birthdate, height, source, sourceUrl;

        boolean empty() { return realName == null && birthdate == null && height == null; }

        void fill(Result o) {
            if (realName == null) realName = o.realName;
            if (birthdate == null) birthdate = o.birthdate;
            if (height == null) height = o.height;
            if (source == null && !o.empty()) { source = o.source; sourceUrl = o.sourceUrl; }
        }
    }

    private static final String UA = "VidShelf/2.0 (personal video library app)";

    public static Result find(String name, String group) {
        Result r = new Result();
        try { r.fill(fromWikipediaPerson(name, group)); } catch (Exception ignored) {}
        if (r.birthdate == null || r.realName == null || r.height == null) {
            try { if (group != null && !group.isEmpty()) r.fill(fromGroupArticle(name, group)); } catch (Exception ignored) {}
        }
        if (r.birthdate == null || r.height == null) {
            try { r.fill(fromWikidata(name, group)); } catch (Exception ignored) {}
        }
        return r;
    }

    // ------------------------------------------------------------------ 위키백과: 인물 문서
    private static Result fromWikipediaPerson(String name, String group) throws Exception {
        Set<String> titles = new LinkedHashSet<>();
        String q = (group == null ? "" : group + " ") + name;
        for (String t : search(q)) titles.add(t);
        titles.add(name + " (가수)");
        titles.add(name);
        for (String title : titles) {
            if (!title.replace(" ", "").contains(name.replace(" ", ""))) continue;
            String wt = wikitext(title);
            if (wt == null) continue;
            if (group != null && !group.isEmpty() && !mentions(wt, group)) continue;
            Result r = parseInfobox(wt);
            if (!r.empty()) {
                r.source = "위키백과: " + title;
                r.sourceUrl = "https://ko.wikipedia.org/wiki/" + URLEncoder.encode(title.replace(' ', '_'), "UTF-8");
                return r;
            }
        }
        return new Result();
    }

    // ------------------------------------------------------------------ 위키백과: 그룹 문서의 멤버 목록
    private static Result fromGroupArticle(String name, String group) throws Exception {
        Set<String> titles = new LinkedHashSet<>();
        titles.add(group);
        titles.add(group + " (음악 그룹)");
        for (String t : search(group)) titles.add(t);
        for (String title : titles) {
            String wt = wikitext(title);
            if (wt == null || !mentions(wt, group)) continue;
            String[] lines = clean(wt).split("\n");
            for (int i = 0; i < lines.length; i++) {
                if (!containsWord(lines[i], name)) continue;
                StringBuilder win = new StringBuilder();
                for (int j = i; j < Math.min(lines.length, i + 4); j++) win.append(lines[j]).append(' ');
                Result r = new Result();
                r.birthdate = findDate(win.toString());
                Matcher rn = Pattern.compile("본명[\\s:：=]*([가-힣]{2,5})").matcher(win);
                if (rn.find()) r.realName = rn.group(1);
                Matcher h = HEIGHT.matcher(win);
                if (h.find()) r.height = h.group(1);
                if (r.birthdate != null || r.realName != null) {
                    r.source = "위키백과: " + title + " (멤버 목록)";
                    r.sourceUrl = "https://ko.wikipedia.org/wiki/" + URLEncoder.encode(title.replace(' ', '_'), "UTF-8");
                    return r;
                }
            }
        }
        return new Result();
    }

    // ------------------------------------------------------------------ 위키데이터
    private static Result fromWikidata(String name, String group) throws Exception {
        JSONObject s = getJson("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=ko&uselang=ko&type=item&limit=7&search="
                + URLEncoder.encode(name, "UTF-8"));
        JSONArray hits = s.optJSONArray("search");
        if (hits == null) return new Result();
        for (int i = 0; i < hits.length(); i++) {
            String id = hits.getJSONObject(i).optString("id");
            JSONObject e = getJson("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels|sitelinks&languages=ko|en&ids=" + id)
                    .getJSONObject("entities").getJSONObject(id);
            JSONObject claims = e.optJSONObject("claims");
            if (claims == null || !claims.has("P569")) continue;   // 생년월일이 없는 항목은 사람 문서가 아님
            if (group != null && !group.isEmpty() && !memberOf(claims, group)) continue;
            Result r = new Result();
            String t = firstValue(claims, "P569");
            if (t != null && t.length() >= 11) {
                String d = t.substring(1, 11);
                if (!d.endsWith("-00-00")) r.birthdate = d.replace("-00", "-01");
            }
            JSONObject hq = firstValueObj(claims, "P2048");
            if (hq != null) {
                double amount = Double.parseDouble(hq.optString("amount", "0").replace("+", ""));
                String unit = hq.optString("unit");
                if (unit.endsWith("Q11573")) amount *= 100;           // 미터 → cm
                if (amount > 100 && amount < 230) r.height = trimNum(amount);
            }
            JSONObject bn = firstValueObj(claims, "P1477");
            if (bn != null) r.realName = bn.optString("text", null);
            if (!r.empty()) {
                r.source = "위키데이터: " + id;
                r.sourceUrl = "https://www.wikidata.org/wiki/" + id;
                return r;
            }
        }
        return new Result();
    }

    private static boolean memberOf(JSONObject claims, String group) throws Exception {
        JSONArray arr = claims.optJSONArray("P463");
        if (arr == null) return false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject v = arr.getJSONObject(i).getJSONObject("mainsnak").optJSONObject("datavalue");
            if (v == null) continue;
            String gid = v.getJSONObject("value").optString("id");
            JSONObject labels = getJson("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases&languages=ko|en&ids=" + gid)
                    .getJSONObject("entities").getJSONObject(gid);
            if (mentions(labels.toString(), group)) return true;
        }
        return false;
    }

    private static String firstValue(JSONObject claims, String prop) {
        JSONObject o = firstValueObj(claims, prop);
        return o == null ? null : o.optString("time", null);
    }

    private static JSONObject firstValueObj(JSONObject claims, String prop) {
        JSONArray arr = claims.optJSONArray(prop);
        if (arr == null || arr.length() == 0) return null;
        JSONObject dv = arr.optJSONObject(0).optJSONObject("mainsnak").optJSONObject("datavalue");
        if (dv == null) return null;
        Object v = dv.opt("value");
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    // ------------------------------------------------------------------ infobox parsing
    private static final Pattern HEIGHT = Pattern.compile("(1[0-9]{2}(?:\\.[0-9])?)\\s*(?:cm|㎝|센티미터)");

    static Result parseInfobox(String wt) {
        Result r = new Result();
        for (String raw : wt.split("\n")) {
            String line = raw.trim();
            if (!line.startsWith("|")) continue;
            int eq = line.indexOf('=');
            if (eq < 0) continue;
            String key = line.substring(1, eq).trim();
            String val = clean(line.substring(eq + 1)).trim();
            if (val.isEmpty()) continue;
            if (r.realName == null && (key.equals("본명") || key.equals("출생명"))) {
                String v = val.replaceAll("\\(.*?\\)", "").trim();
                Matcher m = Pattern.compile("([가-힣]{2,5})").matcher(v);
                if (m.find()) r.realName = m.group(1);
            }
            if (r.birthdate == null && (key.equals("출생일") || key.equals("출생") || key.equals("생년월일"))) {
                r.birthdate = findDate(line.substring(eq + 1));
            }
            if (r.height == null && (key.equals("키") || key.equals("신장") || key.equals("신체"))) {
                Matcher m = HEIGHT.matcher(val);
                if (m.find()) r.height = m.group(1);
            }
        }
        return r;
    }

    static String findDate(String s) {
        Matcher m = Pattern.compile("출생일과 나이\\s*\\|\\s*(\\d{4})\\s*\\|\\s*(\\d{1,2})\\s*\\|\\s*(\\d{1,2})").matcher(s);
        if (m.find()) return ymd(m);
        m = Pattern.compile("(\\d{4})년\\s*(\\d{1,2})월\\s*(\\d{1,2})일").matcher(s);
        if (m.find()) return ymd(m);
        m = Pattern.compile("(\\d{4})[.\\-/]\\s*(\\d{1,2})[.\\-/]\\s*(\\d{1,2})").matcher(s);
        if (m.find()) return ymd(m);
        return null;
    }

    private static String ymd(Matcher m) {
        int y = Integer.parseInt(m.group(1)), mo = Integer.parseInt(m.group(2)), d = Integer.parseInt(m.group(3));
        if (y < 1900 || y > 2030 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return String.format(Locale.ROOT, "%04d-%02d-%02d", y, mo, d);
    }

    /** 위키 문법을 대략 걷어 내고 글자만 남깁니다. */
    static String clean(String s) {
        s = s.replaceAll("(?s)<ref[^>]*/>", "").replaceAll("(?s)<ref[^>]*>.*?</ref>", "");
        s = s.replaceAll("<[^>]+>", " ");
        s = s.replaceAll("\\[\\[(?:[^|\\]]*\\|)?([^\\]]*)\\]\\]", "$1");
        s = s.replaceAll("\\{\\{lang\\|[^|}]*\\|([^}]*)\\}\\}", "$1");
        s = s.replaceAll("'''?", "");
        return s;
    }

    private static boolean mentions(String text, String group) {
        String t = text.replace(" ", "").toLowerCase(Locale.ROOT);
        String g = group.replace(" ", "").toLowerCase(Locale.ROOT);
        return t.contains(g);
    }

    private static boolean containsWord(String line, String name) {
        int i = line.indexOf(name);
        while (i >= 0) {
            boolean before = i == 0 || !isHangul(line.charAt(i - 1));
            int end = i + name.length();
            boolean after = end >= line.length() || !isHangul(line.charAt(end)) || line.startsWith("(", end);
            if (before && after) return true;
            i = line.indexOf(name, i + 1);
        }
        return false;
    }

    private static boolean isHangul(char c) { return c >= 0xAC00 && c <= 0xD7A3; }

    private static String trimNum(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.format(Locale.ROOT, "%.1f", v);
    }

    // ------------------------------------------------------------------ HTTP
    private static List<String> search(String q) throws Exception {
        JSONObject j = getJson("https://ko.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=" + URLEncoder.encode(q, "UTF-8"));
        List<String> out = new ArrayList<>();
        JSONArray arr = j.optJSONObject("query") == null ? null : j.getJSONObject("query").optJSONArray("search");
        for (int i = 0; arr != null && i < arr.length(); i++) out.add(arr.getJSONObject(i).optString("title"));
        return out;
    }

    private static String wikitext(String title) {
        try {
            JSONObject j = getJson("https://ko.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page="
                    + URLEncoder.encode(title, "UTF-8"));
            JSONObject p = j.optJSONObject("parse");
            return p == null ? null : p.optString("wikitext", null);
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject getJson(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", UA);
        if (c.getResponseCode() >= 400) throw new IOException("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            return new JSONObject(new String(Library.readAll(in), StandardCharsets.UTF_8));
        }
    }
}
