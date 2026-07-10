import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import open from "open";
import sanitizeHtml from "sanitize-html";

export interface ViewerOptions {
  directory: string;
  host?: string;
  port?: number;
  openBrowser?: boolean;
}

export interface ViewerConcept {
  id: string;
  title: string;
  description: string;
  type: string;
  tags: string[];
  resource?: string;
  updatedAt?: string;
  html: string;
}

export interface ViewerData {
  title: string;
  directory: string;
  concepts: ViewerConcept[];
  edges: Array<{ source: string; target: string }>;
}

export interface ViewerServer {
  url: string;
  server: Server;
}

const require = createRequire(import.meta.url);

export async function buildViewerData(directory: string): Promise<ViewerData> {
  const root = path.resolve(directory);
  const files = await findMarkdownFiles(root);
  const conceptFiles = files.filter((file) => !["index.md", "log.md"].includes(path.basename(file)));
  if (conceptFiles.length === 0) throw new Error(`No OKF concept documents found in ${root}`);

  const records = await Promise.all(conceptFiles.map(async (file) => {
    const id = toPosix(path.relative(root, file));
    const raw = await readFile(file, "utf8");
    const parsed = matter(raw);
    const title = stringValue(parsed.data.title) || humanize(path.basename(id, ".md"));
    return {
      concept: {
        id,
        title,
        description: stringValue(parsed.data.description),
        type: stringValue(parsed.data.type) || "Concept",
        tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
        ...(stringValue(parsed.data.resource) ? { resource: stringValue(parsed.data.resource) } : {}),
        ...(stringValue(parsed.data.timestamp) ? { updatedAt: stringValue(parsed.data.timestamp) } : {}),
        html: sanitizeHtml(await marked.parse(parsed.content), {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "h4", "h5", "h6"]),
          allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ["href", "title"], img: ["src", "alt", "title"] },
          allowedSchemes: ["http", "https", "mailto"],
        }),
      } satisfies ViewerConcept,
      raw,
    };
  }));

  const ids = new Set(records.map(({ concept }) => concept.id));
  const edgeKeys = new Set<string>();
  const edges: ViewerData["edges"] = [];
  for (const { concept, raw } of records) {
    for (const match of raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1]?.trim().split(/[?#]/)[0] ?? "";
      if (!href || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) continue;
      const target = href.startsWith("/")
        ? path.posix.normalize(href.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(concept.id), href));
      if (!ids.has(target) || target === concept.id) continue;
      const key = `${concept.id}\0${target}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ source: concept.id, target });
      }
    }
  }

  return {
    title: await readBundleTitle(root),
    directory: root,
    concepts: records.map(({ concept }) => concept).sort((a, b) => a.title.localeCompare(b.title)),
    edges,
  };
}

export async function startViewer(options: ViewerOptions): Promise<ViewerServer> {
  const data = await buildViewerData(options.directory);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  const cytoscapePath = require.resolve("cytoscape/dist/cytoscape.min.js");
  const cytoscapeSource = await readFile(cytoscapePath, "utf8");
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  const server = createServer((request, response) => {
    const url = request.url?.split("?")[0] ?? "/";
    if (url === "/assets/cytoscape.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" });
      response.end(cytoscapeSource);
      return;
    }
    if (url === "/" || url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(viewerHtml(dataJson));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${host}:${port}`;
  if (options.openBrowser !== false) await open(url);
  return { url, server };
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files.sort();
}

async function readBundleTitle(root: string): Promise<string> {
  try {
    const content = await readFile(path.join(root, "index.md"), "utf8");
    const heading = matter(content).content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return heading || humanize(path.basename(root));
  } catch {
    return humanize(path.basename(root));
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function viewerHtml(dataJson: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OKFgen Explorer</title>
  <script>try{document.documentElement.dataset.theme=localStorage.getItem('okfgen-theme')||'light'}catch(e){document.documentElement.dataset.theme='light'}</script>
  <style>
    :root{color-scheme:light;--canvas:#f7f7f8;--surface:#fff;--surface-2:#f4f4f5;--surface-3:#eeeef0;--ink:#1b1b1f;--muted:#707078;--subtle:#96969f;--line:#e3e3e7;--line-strong:#cfcfd5;--accent:#5e6ad2;--accent-hover:#4f5bc4;--accent-soft:#f0f1fb;--code:#f2f2f4;--graph-edge:#a7a7b0;--graph-grid:rgba(94,106,210,.07);--graph-glow:rgba(94,106,210,.14);--shadow:0 8px 24px rgba(18,18,22,.08);--shadow-float:0 18px 50px rgba(18,18,22,.12);--nav:284px;--duration-stagger:40ms;--duration-micro:80ms;--duration-quick:150ms;--duration-fast:250ms;--duration-medium:350ms;--duration-slow:400ms;--duration-very-slow:500ms;--ease-smooth-out:cubic-bezier(.22,1,.36,1);--ease-in-out:ease-in-out;--ease-out:ease-out;--ease-linear:linear;--ease-bounce:cubic-bezier(.34,1.36,.64,1);--distance-micro:4px;--distance-base:8px;--distance-medium:12px;--scale-large:.96;--scale-medium:.97;--scale-small:.98;--blur-small:2px;--blur-medium:3px}
    html[data-theme="dark"]{color-scheme:dark;--canvas:#0b0b0d;--surface:#111113;--surface-2:#171719;--surface-3:#1d1d20;--ink:#f3f3f5;--muted:#aaaab2;--subtle:#777780;--line:#27272b;--line-strong:#38383e;--accent:#828fff;--accent-hover:#9aa4ff;--accent-soft:#202136;--code:#1b1b1e;--graph-edge:#5c5c65;--graph-grid:rgba(130,143,255,.065);--graph-glow:rgba(94,106,210,.18);--shadow:0 8px 28px rgba(0,0,0,.3);--shadow-float:0 22px 60px rgba(0,0,0,.42)}
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{font-family:Inter,"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--canvas);color:var(--ink);letter-spacing:0;transition:background-color var(--duration-quick) var(--ease-in-out),color var(--duration-quick) var(--ease-in-out)}button,input{font:inherit}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .app{display:grid;grid-template-columns:var(--nav) minmax(0,1fr);height:100vh;overflow:hidden}.sidebar{background:var(--surface);color:var(--ink);border-right:1px solid var(--line);display:flex;flex-direction:column;min-width:0}.brand{height:68px;padding:0 18px;display:flex;align-items:center;border-bottom:1px solid var(--line)}.brand-mark{display:flex;align-items:center;gap:11px;min-width:0}.brand-icon{width:30px;height:30px;display:grid;place-items:center;background:var(--accent);color:#fff;border-radius:8px;font-weight:700;font-size:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}.brand h1{font-size:14px;font-weight:600;margin:0;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand p{font-size:11px;color:var(--subtle);margin:3px 0 0}.search-wrap{padding:14px 12px 9px}.search{width:100%;height:36px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:8px;padding:0 11px;outline:none;font-size:13px}.search:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.search::placeholder{color:var(--subtle)}.concept-list{overflow:auto;padding:2px 7px 18px}.concept-btn{width:100%;text-align:left;color:var(--ink);background:transparent;border:0;border-radius:7px;padding:9px 10px;cursor:pointer;display:block}.concept-btn:hover{background:var(--surface-2)}.concept-btn.active{background:var(--accent-soft);color:var(--accent)}.concept-title{font-size:13px;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.concept-meta{font-size:11px;color:var(--subtle);margin-top:3px;display:block}.concept-btn.active .concept-meta{color:var(--accent)}.sidebar-foot{border-top:1px solid var(--line);padding:12px 17px;color:var(--subtle);font-size:10px;line-height:1.45}.sidebar-foot #directory{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sidebar-foot a{color:var(--muted);text-decoration:none}.sidebar-foot a:hover{color:var(--accent)}
    .main{display:grid;grid-template-rows:60px minmax(0,1fr);min-width:0}.toolbar{background:color-mix(in srgb,var(--surface) 94%,transparent);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 18px;gap:16px}.tabs{position:relative;display:grid;grid-template-columns:1fr 1fr;width:150px;background:var(--surface-2);padding:3px;border:1px solid var(--line);border-radius:9px}.tabs::before{content:"";position:absolute;z-index:0;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:6px;background:var(--surface);box-shadow:0 1px 3px rgba(18,18,22,.08);transform:translateX(0);transition:transform var(--duration-fast) var(--ease-smooth-out)}.tabs[data-active="graph"]::before{transform:translateX(100%)}.tab{position:relative;z-index:1;border:0;background:transparent;color:var(--muted);height:30px;padding:0 9px;border-radius:6px;cursor:pointer;font-weight:500;font-size:12px;transition:color var(--duration-quick) var(--ease-in-out)}.tab:hover{color:var(--ink)}.tab.active{color:var(--ink)}.toolbar-meta{display:flex;align-items:center;gap:12px}.stats{font-size:11px;color:var(--subtle)}.theme-toggle,.mobile-menu{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:8px;cursor:pointer;transition:color var(--duration-quick) var(--ease-in-out),background-color var(--duration-quick) var(--ease-in-out),border-color var(--duration-quick) var(--ease-in-out)}.theme-toggle:hover,.mobile-menu:hover{color:var(--ink);border-color:var(--line-strong);background:var(--surface-2)}.theme-toggle{position:relative;overflow:hidden}.theme-icon{position:absolute;display:grid;place-items:center;transition:opacity var(--duration-fast) var(--ease-in-out),transform var(--duration-fast) var(--ease-in-out),filter var(--duration-fast) var(--ease-in-out)}.theme-icon-sun{opacity:0;transform:scale(.8) rotate(-18deg);filter:blur(var(--blur-small))}.theme-icon-moon{opacity:1;transform:scale(1) rotate(0);filter:blur(0)}html[data-theme="dark"] .theme-icon-sun{opacity:1;transform:scale(1) rotate(0);filter:blur(0)}html[data-theme="dark"] .theme-icon-moon{opacity:0;transform:scale(.8) rotate(18deg);filter:blur(var(--blur-small))}.mobile-menu{display:none;font-size:16px}
    .content{min-height:0;position:relative;overflow:hidden}.view{position:absolute;inset:0;height:100%;min-height:0;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(var(--distance-base));filter:blur(var(--blur-small));transition:opacity var(--duration-fast) var(--ease-in-out),transform var(--duration-fast) var(--ease-smooth-out),filter var(--duration-fast) var(--ease-in-out),visibility 0s linear var(--duration-fast)}.view.active{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0);filter:blur(0);transition-delay:0s}.document-view{overflow:auto;background:var(--canvas)}.document-shell{max-width:880px;margin:0 auto;padding:54px 56px 88px}.document-view.is-revealing .document-header,.document-view.is-revealing .markdown,.document-view.is-revealing .outline{animation:content-reveal var(--duration-very-slow) var(--ease-smooth-out) both}.document-view.is-revealing .markdown{animation-delay:var(--duration-stagger)}.document-view.is-revealing .outline{animation-delay:calc(var(--duration-stagger) * 2)}@keyframes content-reveal{from{opacity:0;transform:translateY(var(--distance-medium));filter:blur(var(--blur-medium))}to{opacity:1;transform:translateY(0);filter:blur(0)}}.eyebrow{color:var(--accent);font-family:"SFMono-Regular",Consolas,monospace;font-size:11px;font-weight:500;text-transform:uppercase;margin-bottom:14px}.document-title{font-size:36px;font-weight:600;line-height:1.16;margin:0 0 12px}.document-description{font-size:16px;color:var(--muted);line-height:1.55;margin:0 0 20px;max-width:720px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 32px}.tag{font-size:10px;padding:4px 7px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--muted)}.resource{display:inline-block;color:var(--accent);font-size:12px;margin-bottom:24px;text-decoration:none}.resource:hover{text-decoration:underline}.markdown{border-top:1px solid var(--line);padding-top:30px;font-size:15px;line-height:1.72;color:var(--ink)}.markdown h1,.markdown h2,.markdown h3{line-height:1.25;margin:1.9em 0 .7em;font-weight:600}.markdown h1{font-size:24px}.markdown h2{font-size:19px}.markdown h3{font-size:16px}.markdown a{color:var(--accent);text-decoration-color:color-mix(in srgb,var(--accent) 40%,transparent);text-underline-offset:3px}.markdown code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.86em;background:var(--code);padding:2px 5px;border:1px solid var(--line);border-radius:4px}.markdown pre{overflow:auto;background:var(--surface-2);color:var(--ink);padding:16px;border:1px solid var(--line);border-radius:8px}.markdown pre code{background:transparent;padding:0;border:0}.markdown table{width:100%;border-collapse:collapse;font-size:13px}.markdown th,.markdown td{border-bottom:1px solid var(--line);padding:10px 9px;text-align:left}.markdown th{background:var(--surface-2);font-weight:600}.markdown blockquote{border-left:2px solid var(--accent);margin-left:0;padding-left:16px;color:var(--muted)}
    .document-shell{display:grid;grid-template-columns:minmax(0,1fr) 190px;column-gap:54px;max-width:1120px}.document-header{grid-column:1/-1;padding-bottom:30px}.document-title{font-size:38px;line-height:1.12;letter-spacing:-.8px}.document-updated{display:block;color:var(--subtle);font-size:12px;margin-bottom:20px}.tags{margin-bottom:18px}.resource{margin-bottom:0}.markdown h1,.markdown h2,.markdown h3{scroll-margin-top:24px}.markdown pre{padding:18px;box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 4%,transparent)}.outline{border-left:1px solid var(--line);padding-left:18px;align-self:start;position:sticky;top:24px;max-height:calc(100vh - 110px);overflow:auto}.outline-title{font-size:11px;font-weight:600;color:var(--ink);margin:0 0 12px}.outline-list{display:flex;flex-direction:column;gap:9px}.outline-link{border:0;background:transparent;color:var(--subtle);font-size:11px;text-align:left;padding:0;cursor:pointer;line-height:1.35}.outline-link:hover,.outline-link.active{color:var(--accent)}.outline-link[data-level="3"]{padding-left:10px}
    .graph-view{position:absolute;background:var(--canvas);isolation:isolate;overflow:hidden}.graph-view::before{content:"";position:absolute;z-index:-2;inset:0;background-image:linear-gradient(var(--graph-grid) 1px,transparent 1px),linear-gradient(90deg,var(--graph-grid) 1px,transparent 1px);background-size:32px 32px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.64),transparent 88%)}.graph-view::after{content:"";position:absolute;z-index:-1;width:680px;height:680px;left:50%;top:48%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,var(--graph-glow),transparent 66%);pointer-events:none}.graph-heading{position:absolute;z-index:3;left:22px;top:20px;max-width:300px;pointer-events:none}.graph-kicker{display:flex;align-items:center;gap:7px;margin:0 0 7px;color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.graph-kicker::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 12%,transparent)}.graph-heading h2{font-size:20px;line-height:1.2;letter-spacing:-.35px;margin:0 0 5px}.graph-heading p{font-size:11px;line-height:1.5;color:var(--subtle);margin:0}.graph-toolbar{position:absolute;z-index:4;right:18px;top:18px;display:flex;gap:7px}.graph-btn{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(12px);color:var(--muted);height:34px;padding:0 11px;border-radius:9px;cursor:pointer;box-shadow:var(--shadow);font-size:11px;font-weight:600;transition:color var(--duration-quick) var(--ease-in-out),background-color var(--duration-quick) var(--ease-in-out),border-color var(--duration-quick) var(--ease-in-out),transform var(--duration-fast) var(--ease-smooth-out)}.graph-btn svg{width:13px;height:13px;stroke:currentColor}.graph-btn:hover{color:var(--ink);border-color:var(--line-strong);background:var(--surface);transform:translateY(-1px)}.graph-btn:active{transform:translateY(0) scale(var(--scale-small))}.graph-btn.is-running svg{animation:graph-spin var(--duration-very-slow) var(--ease-smooth-out)}@keyframes graph-spin{to{transform:rotate(180deg)}}.graph-legend{position:absolute;z-index:3;left:22px;bottom:18px;display:flex;align-items:center;gap:11px;background:color-mix(in srgb,var(--surface) 90%,transparent);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:10px;color:var(--subtle);box-shadow:var(--shadow)}.graph-legend span{display:flex;align-items:center;gap:6px}.graph-legend span+span::before{content:"";width:1px;height:12px;background:var(--line);margin-right:5px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent)}.edge-mark{display:inline-block;width:18px;height:1px;background:var(--graph-edge);position:relative}.edge-mark::after{content:"";position:absolute;right:-1px;top:-2px;border-left:4px solid var(--graph-edge);border-top:2.5px solid transparent;border-bottom:2.5px solid transparent}.graph-inspector{position:absolute;z-index:5;right:18px;bottom:18px;width:min(310px,calc(100% - 36px));background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:var(--shadow-float);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(var(--distance-medium)) scale(var(--scale-large));filter:blur(var(--blur-small));transform-origin:bottom right;transition:opacity var(--duration-fast) var(--ease-in-out),transform var(--duration-fast) var(--ease-smooth-out),filter var(--duration-fast) var(--ease-in-out),visibility 0s linear var(--duration-fast)}.graph-inspector[data-open="true"]{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1);filter:blur(0);transition-delay:0s}.graph-inspector-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.graph-type{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:5px 8px}.graph-close{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--subtle);cursor:pointer;font-size:17px;line-height:1;transition:color var(--duration-quick) var(--ease-in-out),background-color var(--duration-quick) var(--ease-in-out),transform var(--duration-fast) var(--ease-smooth-out)}.graph-close:hover{color:var(--ink);background:var(--surface-2);transform:rotate(4deg)}.graph-inspector h3{font-size:17px;letter-spacing:-.25px;margin:0 0 7px}.graph-inspector p{font-size:12px;line-height:1.55;color:var(--muted);margin:0 0 15px}.graph-inspector-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:13px;gap:12px}.graph-degree{font-size:10px;color:var(--subtle)}.graph-open{border:0;border-radius:8px;background:var(--ink);color:var(--surface);height:31px;padding:0 11px;font-size:10px;font-weight:700;cursor:pointer;transition:transform var(--duration-fast) var(--ease-smooth-out),opacity var(--duration-quick) var(--ease-in-out)}.graph-open:hover{transform:translateY(-1px)}.graph-open:active{transform:scale(var(--scale-small))}#graph{position:absolute;inset:0;width:100%;height:100%;cursor:grab}#graph:active{cursor:grabbing}.empty{padding:28px 10px;color:var(--subtle);font-size:12px}
    .sidebar,.toolbar,.document-view,.graph-view,.search,.concept-btn,.tag,.graph-btn,.graph-legend,.markdown pre,.markdown code{transition:background-color var(--duration-quick) var(--ease-in-out),border-color var(--duration-quick) var(--ease-in-out),color var(--duration-quick) var(--ease-in-out)}
    .search-row{position:relative}.search-clear{position:absolute;right:6px;top:4px;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--subtle);cursor:pointer;opacity:0;pointer-events:none;transition:opacity var(--duration-quick) var(--ease-in-out),color var(--duration-quick) var(--ease-in-out)}.search-row.has-value .search-clear{opacity:1;pointer-events:auto}.search-clear:hover{color:var(--ink);background:var(--surface-3)}.search-meta{height:18px;padding:5px 2px 0;color:var(--subtle);font-size:10px}
    @media(max-width:760px){.app{grid-template-columns:1fr}.sidebar{position:fixed;z-index:10;inset:0 16% 0 0;transform:translateX(-105%);transition:transform var(--duration-slow) var(--ease-smooth-out),background-color var(--duration-quick) var(--ease-in-out),border-color var(--duration-quick) var(--ease-in-out),color var(--duration-quick) var(--ease-in-out);box-shadow:var(--shadow)}.sidebar.open{transform:translateX(0)}.main{height:100vh}.mobile-menu{display:grid}.toolbar{padding:0 12px}.stats{display:none}.toolbar-meta{gap:7px}.document-shell{padding:34px 20px 64px}.document-title{font-size:29px}.graph-heading{left:14px;top:14px}.graph-heading p{display:none}.graph-toolbar{right:12px;top:12px}.graph-btn{width:34px;padding:0;justify-content:center}.graph-btn-label{display:none}.graph-legend{display:none}.graph-inspector{right:12px;bottom:12px;width:calc(100% - 24px);transform-origin:bottom center}}
    @media(max-width:760px){.document-shell{display:block;padding:34px 20px 64px}.document-header{padding-bottom:28px}.document-title{font-size:29px;letter-spacing:-.4px}.outline{display:none}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark"><div class="brand-icon">K</div><div><h1 id="bundle-name"></h1><p>Open Knowledge Format</p></div></div></div>
      <div class="search-wrap"><div class="search-row"><input class="search" id="search" type="search" placeholder="Search concepts..." aria-label="Search concepts"><button class="search-clear" id="search-clear" type="button" aria-label="Clear search" title="Clear search">×</button></div><div class="search-meta" id="search-meta"></div></div>
      <nav class="concept-list" id="concept-list" aria-label="Concepts"></nav>
      <div class="sidebar-foot"><div id="directory"></div><div style="margin-top:7px">Built with love by <a href="https://github.com/Arindam200" target="_blank" rel="noreferrer">Arindam</a></div></div>
    </aside>
    <main class="main">
      <header class="toolbar"><div style="display:flex;align-items:center;gap:8px"><button class="mobile-menu" id="menu" aria-label="Open navigation" title="Open navigation">☰</button><div class="tabs" id="view-tabs" data-active="document"><button class="tab active" data-view="document">Document</button><button class="tab" data-view="graph">Graph</button></div></div><div class="toolbar-meta"><div class="stats" id="stats"></div><button class="theme-toggle" id="theme-toggle" aria-label="Switch to dark theme" title="Switch theme"><span class="theme-icon theme-icon-moon" aria-hidden="true">☾</span><span class="theme-icon theme-icon-sun" aria-hidden="true">☀</span></button></div></header>
      <div class="content">
        <section class="view document-view active" id="document-view"><article class="document-shell"><header class="document-header"><div class="eyebrow" id="concept-type"></div><h2 class="document-title" id="concept-title"></h2><p class="document-description" id="concept-description"></p><span class="document-updated" id="document-updated"></span><div class="tags" id="tags"></div><a class="resource" id="resource" target="_blank" rel="noreferrer"></a></header><div class="markdown" id="markdown"></div><aside class="outline" id="outline"><p class="outline-title">On this page</p><nav class="outline-list" aria-label="On this page"></nav></aside></article></section>
        <section class="view graph-view" id="graph-view">
          <header class="graph-heading"><div class="graph-kicker">Knowledge map</div><h2>Explore connections</h2><p>Select a concept to trace its references and open its details.</p></header>
          <div class="graph-toolbar">
            <button class="graph-btn" id="fit" aria-label="Fit graph to view" title="Fit graph to view"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="graph-btn-label">Fit view</span></button>
            <button class="graph-btn" id="relayout" aria-label="Re-layout graph" title="Re-layout graph"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 6A5.5 5.5 0 1 0 13 10.6M13.2 6V2.8M13.2 6H10" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="graph-btn-label">Re-layout</span></button>
          </div>
          <div id="graph" role="application" aria-label="Interactive concept relationship graph"></div>
          <div class="graph-legend" aria-hidden="true"><span><i class="dot"></i>Concept</span><span><i class="edge-mark"></i>Reference</span><span>Drag · scroll to zoom</span></div>
          <aside class="graph-inspector" id="graph-inspector" data-open="false" aria-live="polite">
            <div class="graph-inspector-top"><span class="graph-type" id="graph-type"></span><button class="graph-close" id="graph-close" aria-label="Close concept details">×</button></div>
            <h3 id="graph-title"></h3><p id="graph-description"></p>
            <div class="graph-inspector-foot"><span class="graph-degree" id="graph-degree"></span><button class="graph-open" id="graph-open">Open document →</button></div>
          </aside>
        </section>
      </div>
    </main>
  </div>
  <script src="/assets/cytoscape.js"></script>
  <script>window.OKF_DATA=${dataJson};</script>
  <script>
    (function(){
      var data=window.OKF_DATA, current=data.concepts[0], cy, selectedGraphId='';
      var list=document.getElementById('concept-list'), search=document.getElementById('search'), searchRow=document.querySelector('.search-row'), searchMeta=document.getElementById('search-meta'), sidebar=document.getElementById('sidebar'), themeToggle=document.getElementById('theme-toggle'), graphInspector=document.getElementById('graph-inspector');
      document.getElementById('bundle-name').textContent=data.title;
      document.getElementById('directory').textContent=data.directory;
      document.getElementById('stats').textContent=data.concepts.length+' concepts · '+data.edges.length+' connections';
      function renderList(query){
        var q=(query||'').toLowerCase(); list.innerHTML=''; var matches=data.concepts.filter(function(c){return !q||[c.title,c.description,c.type,c.tags.join(' ')].join(' ').toLowerCase().indexOf(q)>=0});
        searchRow.classList.toggle('has-value',Boolean(q)); searchMeta.textContent=q?(matches.length+' result'+(matches.length===1?'':'s')):'Press / to search';
        matches.forEach(function(c){
          var b=document.createElement('button'); b.className='concept-btn'+(current&&current.id===c.id?' active':''); b.dataset.id=c.id;
          var t=document.createElement('span'); t.className='concept-title'; t.textContent=c.title; var m=document.createElement('span'); m.className='concept-meta'; m.textContent=c.type;
          b.appendChild(t); b.appendChild(m); b.onclick=function(){selectConcept(c.id); sidebar.classList.remove('open')}; list.appendChild(b);
        });
        if(!list.children.length){var e=document.createElement('div');e.className='empty';e.textContent='No matching concepts';list.appendChild(e)}
      }
      function selectConcept(id){
        var found=data.concepts.find(function(c){return c.id===id}); if(!found)return; current=found;
        document.getElementById('concept-type').textContent=found.type+' · '+found.id;
        document.getElementById('concept-title').textContent=found.title;
        document.getElementById('concept-description').textContent=found.description;
        var updated=document.getElementById('document-updated'); if(found.updatedAt){var date=new Date(found.updatedAt);updated.textContent=Number.isNaN(date.getTime())?'Last updated '+found.updatedAt:'Last updated '+date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}else{updated.textContent=''}
        var tags=document.getElementById('tags'); tags.innerHTML=''; found.tags.forEach(function(tag){var s=document.createElement('span');s.className='tag';s.textContent=tag;tags.appendChild(s)});
        var r=document.getElementById('resource'); if(found.resource){r.href=found.resource;r.textContent='Open canonical resource ↗';r.style.display='inline-block'}else{r.style.display='none'}
        document.getElementById('markdown').innerHTML=found.html; buildOutline(); renderList(search.value);
        var documentView=document.getElementById('document-view');documentView.classList.remove('is-revealing');void documentView.offsetWidth;documentView.classList.add('is-revealing');
        if(cy){cy.elements().removeClass('selected');var node=cy.getElementById(id);node.addClass('selected');cy.animate({center:{eles:node},duration:motionMs('--duration-fast',250)})}
        showView('document');
      }
      function buildOutline(){var nav=document.querySelector('#outline .outline-list');nav.innerHTML='';document.querySelectorAll('#markdown h1,#markdown h2,#markdown h3').forEach(function(heading,index){var id='section-'+index;heading.id=id;var link=document.createElement('button');link.className='outline-link';link.dataset.level=heading.tagName.slice(1);link.textContent=heading.textContent;link.onclick=function(){document.getElementById(id).scrollIntoView({behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})};nav.appendChild(link)})}
      function showView(name){document.getElementById('view-tabs').dataset.active=name;document.querySelectorAll('.view').forEach(function(el){el.classList.toggle('active',el.id===name+'-view')});document.querySelectorAll('.tab').forEach(function(el){var active=el.dataset.view===name;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active))});if(name==='graph'){initGraph();window.OKF_CY=cy;setTimeout(function(){cy.resize();fitGraph(false);updateGraphOverlapState()},40)}}
      function graphColors(){var dark=document.documentElement.dataset.theme==='dark';return{ink:dark?'#f3f3f5':'#1b1b1f',muted:dark?'#aaaab2':'#707078',edge:dark?'#5c5c65':'#a7a7b0',edgeActive:dark?'#9aa4ff':'#5e6ad2',border:dark?'#111113':'#fff',label:dark?'#111113':'#fff'}}
      function typeColor(type){var value=(type||'').toLowerCase();if(value.indexOf('api')>=0)return'#8b5cf6';if(value.indexOf('metric')>=0)return'#0ea5a4';if(value.indexOf('guide')>=0||value.indexOf('playbook')>=0)return'#e06c4f';if(value.indexOf('schema')>=0||value.indexOf('model')>=0)return'#d79a28';return'#5e6ad2'}
      function graphStyle(compact){var color=graphColors();return[
        {selector:'node',style:{'background-color':'data(color)','label':'data(label)','font-size':compact?10:11,'font-weight':600,'font-family':'Inter,system-ui,sans-serif','color':color.ink,'text-wrap':'wrap','text-max-width':compact?86:128,'text-valign':'bottom','text-margin-y':10,'text-background-color':color.label,'text-background-opacity':compact?0:.88,'text-background-padding':4,'text-background-shape':'roundrectangle','width':compact?28:32,'height':compact?28:32,'border-width':4,'border-color':color.border,'overlay-color':'data(color)','overlay-opacity':0,'overlay-padding':8,'transition-property':'width height border-width opacity overlay-opacity background-color','transition-duration':'250ms','transition-timing-function':'ease-out-cubic'}},
        {selector:'edge',style:{'width':1.5,'opacity':.58,'line-color':color.edge,'target-arrow-color':color.edge,'target-arrow-shape':'triangle','curve-style':'bezier','arrow-scale':.68,'transition-property':'width opacity line-color target-arrow-color','transition-duration':'250ms','transition-timing-function':'ease-out-cubic'}},
        {selector:'node.hovered',style:{'width':39,'height':39,'border-width':5,'overlay-opacity':.1}},
        {selector:'node.selected',style:{'width':43,'height':43,'border-width':5,'overlay-opacity':.14}},
        {selector:'node.neighbor',style:{'border-width':5}},
        {selector:'edge.selected-path',style:{'width':2.5,'opacity':1,'line-color':color.edgeActive,'target-arrow-color':color.edgeActive,'arrow-scale':.86}},
        {selector:'.dimmed',style:{'opacity':.14}},
        {selector:'.is-entering',style:{'opacity':0}}
      ]}
      function applyGraphTheme(){if(!cy)return;cy.style(graphStyle(window.innerWidth<760))}
      function motionMs(token,fallback){if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return 0;var raw=getComputedStyle(document.documentElement).getPropertyValue(token).trim();if(!raw)return fallback;return raw.endsWith('ms')?parseFloat(raw):parseFloat(raw)*1000}
      function simpleGraph(){return data.concepts.length<=8}
      function graphHasOverlaps(){if(!cy)return false;var nodes=cy.nodes().toArray();for(var i=0;i<nodes.length;i++){var a=nodes[i].renderedBoundingBox();for(var j=i+1;j<nodes.length;j++){var b=nodes[j].renderedBoundingBox();if(a.x1<b.x2+10&&a.x2>b.x1-10&&a.y1<b.y2+10&&a.y2>b.y1-10)return true}}return false}
      function updateGraphOverlapState(){if(!cy)return;window.OKF_GRAPH_OVERLAPS=graphHasOverlaps();var graph=document.getElementById('graph');if(graph)graph.dataset.overlaps=window.OKF_GRAPH_OVERLAPS?'true':'false'}
      function graphLayout(animate){if(simpleGraph()){var container=document.getElementById('graph'),radius=Math.min(window.innerWidth<760?118:168,72+data.concepts.length*28),cx=container.clientWidth/2,cyCenter=container.clientHeight/2;return{name:'circle',animate:animate,animationDuration:motionMs('--duration-slow',400),fit:false,radius:radius,boundingBox:{x1:cx-radius,y1:cyCenter-radius,w:radius*2,h:radius*2},startAngle:-Math.PI/2,clockwise:true}}return{name:'cose',animate:animate,animationDuration:motionMs('--duration-very-slow',500),fit:true,padding:window.innerWidth<760?70:105,nodeRepulsion:9000,idealEdgeLength:125,edgeElasticity:90,nestingFactor:1.2,gravity:.7,numIter:900}}
      function fitGraph(animated){if(!cy)return;var duration=animated===false?0:motionMs('--duration-fast',250);if(simpleGraph()){cy.animate({center:{eles:cy.nodes()},zoom:window.innerWidth<760?.82:1,duration:duration,easing:'ease-out-cubic'})}else{cy.animate({fit:{eles:cy.elements(),padding:window.innerWidth<760?70:105},duration:duration,easing:'ease-out-cubic'})}}
      function revealGraph(){if(!cy||motionMs('--duration-fast',250)===0)return;var nodes=cy.nodes(),edges=cy.edges();nodes.addClass('is-entering');edges.addClass('is-entering');nodes.forEach(function(node,index){setTimeout(function(){node.removeClass('is-entering')},index*motionMs('--duration-stagger',40))});setTimeout(function(){edges.removeClass('is-entering')},Math.min(nodes.length,8)*motionMs('--duration-stagger',40))}
      function clearGraphClasses(){if(!cy)return;cy.elements().removeClass('dimmed neighbor selected-path hovered selected')}
      function paintGraphFocus(id){if(!cy)return;clearGraphClasses();var node=cy.getElementById(id);if(!node||node.empty())return;var neighborhood=node.closedNeighborhood();cy.elements().difference(neighborhood).addClass('dimmed');neighborhood.nodes().difference(node).addClass('neighbor');neighborhood.edges().addClass('selected-path');node.addClass('selected')}
      function showGraphInspector(id){var concept=data.concepts.find(function(c){return c.id===id});if(!concept)return;var degree=data.edges.filter(function(e){return e.source===id||e.target===id}).length;document.getElementById('graph-type').textContent=concept.type;document.getElementById('graph-title').textContent=concept.title;document.getElementById('graph-description').textContent=concept.description||'Open this concept to read the complete document.';document.getElementById('graph-degree').textContent=degree+' direct '+(degree===1?'connection':'connections');graphInspector.dataset.open='true'}
      function selectGraphNode(id){selectedGraphId=id;paintGraphFocus(id);showGraphInspector(id)}
      function clearGraphSelection(){selectedGraphId='';clearGraphClasses();graphInspector.dataset.open='false'}
      function initGraph(){if(cy)return;var compact=window.innerWidth<760;cy=cytoscape({container:document.getElementById('graph'),minZoom:.3,maxZoom:2.2,boxSelectionEnabled:false,elements:data.concepts.map(function(c){return{data:{id:c.id,label:c.title,type:c.type,color:typeColor(c.type)}}}).concat(data.edges.map(function(e,i){return{data:{id:'e'+i,source:e.source,target:e.target}}})),style:graphStyle(compact),layout:graphLayout(false)});revealGraph();cy.on('tap','node',function(event){selectGraphNode(event.target.id())});cy.on('tap',function(event){if(event.target===cy)clearGraphSelection()});cy.on('mouseover','node',function(event){if(!selectedGraphId){paintGraphFocus(event.target.id());event.target.addClass('hovered')}});cy.on('mouseout','node',function(){if(selectedGraphId)paintGraphFocus(selectedGraphId);else clearGraphClasses()})}
      search.addEventListener('input',function(){renderList(search.value)});document.getElementById('search-clear').onclick=function(){search.value='';renderList('');search.focus()};document.addEventListener('keydown',function(event){if(event.key==='/'&&document.activeElement!==search&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){event.preventDefault();search.focus()}if(event.key==='Escape'&&document.activeElement===search){search.value='';renderList('');search.blur()}});document.getElementById('menu').onclick=function(){sidebar.classList.toggle('open')};
      function syncThemeButton(){var dark=document.documentElement.dataset.theme==='dark';themeToggle.setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme')}
      themeToggle.onclick=function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('okfgen-theme',next)}catch(e){}syncThemeButton();applyGraphTheme()};syncThemeButton();
      document.querySelectorAll('.tab').forEach(function(tab){tab.onclick=function(){showView(tab.dataset.view)}});
      document.getElementById('fit').onclick=function(){fitGraph(true)};document.getElementById('relayout').onclick=function(){var button=this;button.classList.add('is-running');var layout=cy.layout(graphLayout(true));layout.one('layoutstop',function(){fitGraph(true);setTimeout(function(){button.classList.remove('is-running')},motionMs('--duration-fast',250))});layout.run()};
      document.getElementById('graph-close').onclick=clearGraphSelection;document.getElementById('graph-open').onclick=function(){if(selectedGraphId)selectConcept(selectedGraphId)};
      var resizeTimer;window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){if(!cy)return;cy.resize();applyGraphTheme();if(document.getElementById('graph-view').classList.contains('active'))fitGraph(false)},80)});
      document.getElementById('markdown').addEventListener('click',function(event){var a=event.target.closest('a');if(!a)return;var href=a.getAttribute('href')||'';if(!href.endsWith('.md'))return;event.preventDefault();var base=current.id.split('/').slice(0,-1).join('/');var target=href.charAt(0)==='/'?href.slice(1):(base?base+'/':'')+href;var parts=[];target.split('/').forEach(function(p){if(p==='..')parts.pop();else if(p!=='.')parts.push(p)});selectConcept(parts.join('/'))});
      renderList(''); if(current)selectConcept(current.id);
    })();
  </script>
</body>
</html>`;
}
