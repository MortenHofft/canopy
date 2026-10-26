// Forester cross-check oracle. Reads one JSON line per fixture from stdin and writes one JSON line
// per fixture to stdout, matching the shape dendropy-oracle.py uses so src/oracle.mjs can consume
// either.
//
// Classpath: /home/user/cmzmasek/forester/forester/java/forester.jar
//
// Not run as part of the normal test suite; invoked from src/forester-oracle.mjs.
//
// Forester is GPL-3 licensed. We call it as an external process (classpath isolation), compare
// its parse outcome against our fixtures, and never link its code into gbif-phylo.
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.forester.io.parsers.nhx.NHXParser;
import org.forester.io.parsers.nexus.NexusPhylogeniesParser;
import org.forester.phylogeny.Phylogeny;
import org.forester.phylogeny.PhylogenyNode;
import org.forester.phylogeny.iterators.PhylogenyNodeIterator;

public class ForesterOracle {

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = in.readLine()) != null) {
            String s = line.trim();
            if (s.isEmpty()) continue;
            // Parse the fixture envelope by hand to avoid pulling in a JSON lib. The input is
            // a one-line JSON object with id, kind, input, wellFormed, optional tipCount/tipLabels.
            String id = extract(s, "id");
            String kind = extract(s, "kind");
            String input = extractEscaped(s, "input");
            try {
                Phylogeny[] trees;
                if ("nexus".equals(kind)) {
                    NexusPhylogeniesParser p = new NexusPhylogeniesParser();
                    // NexusPhylogeniesParser treats a raw String as a filename (ParserUtils.
                    // createReader). It accepts StringBuilder or StringBuffer as content, though,
                    // so wrap. NHXParser handles String as content directly, no wrap needed.
                    p.setSource(new StringBuilder(input));
                    trees = p.parse();
                } else {
                    trees = NHXParser.parse(input);
                }
                if (trees == null || trees.length == 0) {
                    System.out.println(resultCrash(id, "no trees"));
                    continue;
                }
                Phylogeny t = trees[0];
                int tipCount = 0;
                List<String> labels = new ArrayList<>();
                PhylogenyNodeIterator it = t.iteratorExternalForward();
                while (it.hasNext()) {
                    PhylogenyNode n = it.next();
                    tipCount++;
                    labels.add(n.getName() == null ? "" : n.getName());
                }
                Collections.sort(labels);
                System.out.println(resultOk(id, tipCount, labels));
            } catch (Throwable e) {
                String msg = e.getClass().getSimpleName() + ": " + (e.getMessage() == null ? "" : e.getMessage());
                if (msg.length() > 160) msg = msg.substring(0, 160);
                System.out.println(resultError(id, msg));
            }
            System.out.flush();
        }
    }

    // --- Minimal JSON helpers.
    private static String extract(String s, String key) {
        int k = s.indexOf("\"" + key + "\":\"");
        if (k < 0) return "";
        int start = k + key.length() + 4;
        int end = findStringEnd(s, start);
        return unescape(s.substring(start, end));
    }
    private static String extractEscaped(String s, String key) {
        return extract(s, key);
    }
    private static int findStringEnd(String s, int start) {
        for (int i = start; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\') { i++; continue; }
            if (c == '"') return i;
        }
        return s.length();
    }
    private static String unescape(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                switch (n) {
                    case 'n': out.append('\n'); break;
                    case 'r': out.append('\r'); break;
                    case 't': out.append('\t'); break;
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    case '/': out.append('/'); break;
                    case 'u':
                        if (i + 4 < s.length()) {
                            int cp = Integer.parseInt(s.substring(i + 1, i + 5), 16);
                            out.append((char) cp);
                            i += 4;
                        }
                        break;
                    default: out.append(n);
                }
            } else out.append(c);
        }
        return out.toString();
    }
    private static String jsonEsc(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
    private static String resultOk(String id, int tipCount, List<String> labels) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"id\":\"").append(jsonEsc(id)).append("\",\"verdict\":\"parsed\",\"tipCount\":").append(tipCount).append(",\"tipLabels\":[");
        for (int i = 0; i < labels.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(jsonEsc(labels.get(i))).append('"');
        }
        sb.append("]}");
        return sb.toString();
    }
    private static String resultError(String id, String msg) {
        return "{\"id\":\"" + jsonEsc(id) + "\",\"verdict\":\"error\",\"note\":\"" + jsonEsc(msg) + "\"}";
    }
    private static String resultCrash(String id, String msg) {
        return "{\"id\":\"" + jsonEsc(id) + "\",\"verdict\":\"crash\",\"note\":\"" + jsonEsc(msg) + "\"}";
    }
}
