/* ======================================================================
   AI4Aging - index.js
   ----------------------------------------------------------------------
   What this file does:
     1. Mobile menu button and "current section" highlight in the nav.
     2. Reads references.bib, turns each BibTeX entry into a citation,
        and shows them in the Publications section (newest first).
     3. Theme filter buttons above the publication list.

   You normally do NOT need to edit this file.
     - To add papers, edit references.bib.
     - To rename themes or add a new one, edit THEMES just below.
   ====================================================================== */

(function () {
  "use strict";

  /* --------------------------------------------------------------------
     SETTINGS
     -------------------------------------------------------------------- */

  // Research themes. A paper is tagged with a theme when its BibTeX
  // "keywords" field contains one of the words in "match".
  // The "id" must also match a data-theme="..." filter button in index.html.
  var THEMES = [
    { id: "voice",        label: "Voice Assistants",     match: ["voice"] },
    { id: "reminiscence", label: "Reminiscence Therapy", match: ["reminiscence"] },
    { id: "aac",          label: "AAC for Dementia",     match: ["aac", "augmentative"] }
  ];

  // The BibTeX file to read (used when the page is on a web server).
  var BIB_FILE = "references.bib";

  // Month names, so "month = {mar}" can be used for sorting.
  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };


  /* ====================================================================
     PART 1: NAVIGATION
     ==================================================================== */

  function setUpNavigation() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    }

    // Open/close the menu on small screens
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Close the menu after choosing a link, or when Escape is pressed
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Highlight the nav link of the section currently on screen
    if (!("IntersectionObserver" in window)) return;
    var links = nav.querySelectorAll('a[href^="#"]');
    var linkFor = {};
    links.forEach(function (link) {
      linkFor[link.getAttribute("href").slice(1)] = link;
    });

    var observer = new IntersectionObserver(function (observed) {
      observed.forEach(function (item) {
        if (!item.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.remove("is-active");
          link.removeAttribute("aria-current");
        });
        var active = linkFor[item.target.id];
        if (active) {
          active.classList.add("is-active");
          active.setAttribute("aria-current", "true");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });

    Object.keys(linkFor).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  function updateCopyrightYear() {
    var el = document.getElementById("copyright-year");
    if (el) el.textContent = String(new Date().getFullYear());
  }


  /* ====================================================================
     PART 2: BIBTEX PARSER
     --------------------------------------------------------------------
     parseBibTeX(text) returns { entries: [...], skipped: [...] }.
     Each entry looks like:
       { type: "article", key: "smith2025", fields: { title: "...", ... } }
     Anything it cannot understand is added to "skipped" instead of
     stopping the page.
     ==================================================================== */

  function parseBibTeX(text) {
    var entries = [];
    var skipped = [];
    var macros = {};   // values defined with @string{...}
    var pos = 0;

    while (true) {
      var at = text.indexOf("@", pos);
      if (at === -1) break;

      // Read the entry type, e.g. "article"
      var typeMatch = /^@\s*([a-zA-Z]+)\s*([{(])/.exec(text.slice(at, at + 60));
      if (!typeMatch) { pos = at + 1; continue; }   // a stray "@", not an entry

      var type = typeMatch[1].toLowerCase();
      var open = typeMatch[2];
      var bodyStart = at + typeMatch[0].length;
      var bodyEnd = findClosing(text, bodyStart, open === "{" ? "}" : ")");

      if (bodyEnd.error) {
        skipped.push({ reason: bodyEnd.error, snippet: text.slice(at, at + 80) });
        pos = bodyEnd.resumeAt;
        continue;
      }

      var body = text.slice(bodyStart, bodyEnd.index);
      pos = bodyEnd.index + 1;

      if (type === "comment" || type === "preamble") continue;

      try {
        if (type === "string") {
          var defs = parseFields(body, macros);
          Object.keys(defs).forEach(function (name) { macros[name] = defs[name]; });
          continue;
        }

        var comma = body.indexOf(",");
        if (comma === -1) throw new Error("entry has no fields");
        var key = body.slice(0, comma).trim();
        if (!key || /[\s{}"]/.test(key)) throw new Error("missing or invalid citation key");

        var fields = parseFields(body.slice(comma + 1), macros);
        if (!fields.title) throw new Error("missing title");

        entries.push({ type: type, key: key, fields: fields });
      } catch (err) {
        skipped.push({ reason: err.message, snippet: text.slice(at, at + 80) });
      }
    }

    return { entries: entries, skipped: skipped };
  }

  // Find the closing "}" or ")" of an entry, counting nested braces.
  // If a new "@type{" appears at the start of a line first, the current
  // entry is probably missing a closing brace: report an error and
  // resume parsing at that new entry so the rest of the file still works.
  function findClosing(text, start, closeChar) {
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      var ch = text[i];
      if (ch === "\\") { i++; continue; }            // skip escaped characters like \{
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 0 && closeChar === "}") return { index: i };
        depth--;
        if (depth < 0) return { error: "unbalanced braces", resumeAt: i + 1 };
      } else if (ch === ")" && depth === 0 && closeChar === ")") {
        return { index: i };
      } else if (ch === "\n" && /^\s*@\s*[a-zA-Z]+\s*[{(]/.test(text.slice(i + 1, i + 60))) {
        return { error: "entry is not closed (missing \"}\")", resumeAt: i + 1 };
      }
    }
    return { error: "entry is not closed (missing \"}\")", resumeAt: text.length };
  }

  // Parse "name = value, name = value, ..." into an object.
  // Values may be {braced}, "quoted", numbers, or @string names,
  // joined with "#".
  function parseFields(src, macros) {
    var fields = {};
    var i = 0;

    function skipSpace() {
      while (i < src.length && /\s/.test(src[i])) i++;
    }

    while (true) {
      skipSpace();
      while (src[i] === ",") { i++; skipSpace(); }   // tolerate extra commas
      if (i >= src.length) break;

      var nameMatch = /^[a-zA-Z0-9_\-:.+]+/.exec(src.slice(i));
      if (!nameMatch) throw new Error("unexpected text near \"" + src.slice(i, i + 20) + "\"");
      var name = nameMatch[0].toLowerCase();
      i += nameMatch[0].length;

      skipSpace();
      if (src[i] !== "=") throw new Error("field \"" + name + "\" has no \"=\"");
      i++;

      var value = "";
      while (true) {
        skipSpace();
        var ch = src[i];
        if (ch === "{" || ch === "\"") {
          var end = readDelimited(src, i);
          value += src.slice(i + 1, end);
          i = end + 1;
        } else {
          var word = /^[^\s,#}]+/.exec(src.slice(i));
          if (!word) throw new Error("field \"" + name + "\" has no value");
          var w = word[0];
          var lower = w.toLowerCase();
          if (/^\d+$/.test(w)) value += w;
          else if (macros.hasOwnProperty(lower)) value += macros[lower];
          else if (MONTHS.hasOwnProperty(lower.slice(0, 3)) && lower.length <= 9) value += lower.slice(0, 3);
          else value += w;
          i += w.length;
        }
        skipSpace();
        if (src[i] === "#") { i++; continue; }      // string concatenation
        break;
      }

      fields[name] = value;
      skipSpace();
      if (i < src.length && src[i] !== ",") {
        throw new Error("missing comma after field \"" + name + "\"");
      }
    }
    return fields;
  }

  // Given the position of "{" or "\"", return the position of its partner.
  function readDelimited(src, start) {
    var quoted = src[start] === "\"";
    var depth = 0;
    for (var i = start + (quoted ? 1 : 0); i < src.length; i++) {
      var ch = src[i];
      if (ch === "\\") { i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (!quoted && depth === 0) return i;
        if (depth < 0) break;
      } else if (ch === "\"" && quoted && depth === 0) {
        return i;
      }
    }
    throw new Error("a value is missing its closing " + (quoted ? "quote" : "brace"));
  }


  /* ====================================================================
     PART 3: TURNING BIBTEX VALUES INTO READABLE TEXT
     ==================================================================== */

  // Convert common LaTeX into plain text: accents, dashes, \&, braces.
  function cleanLatex(s) {
    if (!s) return "";
    var accents = {
      "\"": "̈", "'": "́", "`": "̀", "^": "̂", "~": "̃",
      "=": "̄", ".": "̇", "c": "̧", "v": "̌", "u": "̆", "H": "̋"
    };
    return s
      .replace(/\\(["'`^~=.])\s*\{?\s*(\\[ij]|[A-Za-z])\s*\}?/g, function (m, mark, letter) {
        return (letter.replace("\\", "") + accents[mark]).normalize("NFC");
      })
      .replace(/\\([cvuH])\s*\{\s*([A-Za-z])\s*\}/g, function (m, mark, letter) {
        return (letter + accents[mark]).normalize("NFC");
      })
      .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L)(?![a-zA-Z])\s*/g, function (m, c) {
        return { ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", o: "ø", O: "Ø", l: "ł", L: "Ł" }[c];
      })
      .replace(/\\([&%$#_])/g, "$1")
      .replace(/\\[a-zA-Z]+\s*/g, "")      // drop other commands like \emph, \textit
      .replace(/---/g, "—")
      .replace(/--/g, "–")
      .replace(/``|''/g, "\"")
      .replace(/~/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Split on a separator word (like " and ") but not inside {braces}.
  function splitTopLevel(s, separatorRegex) {
    var parts = [];
    var depth = 0;
    var last = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      else if (depth === 0) {
        var m = separatorRegex.exec(s.slice(i));
        if (m && m.index === 0) {
          parts.push(s.slice(last, i));
          i += m[0].length - 1;
          last = i + 1;
        }
      }
    }
    parts.push(s.slice(last));
    return parts.map(function (p) { return p.trim(); }).filter(Boolean);
  }

  // "Doe, Jane and Smith, John" -> "Jane Doe, John Smith"
  function formatAuthors(raw) {
    if (!raw) return "";
    var names = splitTopLevel(raw, /^\s+and\s+/i).map(function (name) {
      if (name.toLowerCase() === "others") return "et al.";
      var parts = splitTopLevel(name, /^,/);
      if (parts.length === 2) name = parts[1] + " " + parts[0];             // Last, First
      else if (parts.length >= 3) name = parts[2] + " " + parts[0] + ", " + parts[1]; // Last, Jr, First
      return cleanLatex(name);
    });

    if (names[names.length - 1] === "et al.") {
      names.pop();
      return names.join(", ") + " et al.";
    }
    if (names.length <= 2) return names.join(" and ");
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  // Where the work appeared, depending on the entry type.
  function formatVenue(type, f) {
    var c = function (name) { return cleanLatex(f[name] || ""); };
    switch (type) {
      case "article":
        return c("journal");
      case "inproceedings":
      case "conference":
      case "incollection":
        return c("booktitle");
      case "book":
        return c("publisher");
      case "phdthesis":
        return ["PhD dissertation", c("school")].filter(Boolean).join(", ");
      case "mastersthesis":
        return ["Master's thesis", c("school")].filter(Boolean).join(", ");
      case "techreport":
        return ["Technical report", c("institution")].filter(Boolean).join(", ");
      case "misc":
        if (f.howpublished) return c("howpublished");
        if (f.eprint) return (f.archiveprefix ? c("archiveprefix") + ":" : "") + c("eprint");
        return c("publisher") || c("note");
      default:
        return c("journal") || c("booktitle") || c("publisher") || c("howpublished") || c("note");
    }
  }

  // Volume, issue, and pages, e.g. "12(3), 1–20"
  function formatDetails(f) {
    var parts = [];
    var vol = cleanLatex(f.volume || "");
    var num = cleanLatex(f.number || "");
    if (vol) parts.push(vol + (num ? "(" + num + ")" : ""));
    if (f.pages) parts.push("pp. " + cleanLatex(f.pages.replace(/-+/g, "--")));
    return parts.join(", ");
  }

  // Only allow real web addresses in links.
  function safeUrl(url) {
    url = (url || "").replace(/[{}\s]/g, "");
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function getThemes(f) {
    var words = ((f.keywords || "") + "," + (f.theme || "")).toLowerCase();
    return THEMES.filter(function (theme) {
      return theme.match.some(function (m) { return words.indexOf(m) !== -1; });
    }).map(function (theme) { return theme.id; });
  }

  // Turn a parsed entry into the simple object the page displays.
  function toPublication(entry) {
    var f = entry.fields;
    var year = parseInt(f.year, 10);
    var monthText = (f.month || "").toLowerCase().trim();
    var month = parseInt(monthText, 10) || MONTHS[monthText.slice(0, 3)] || 0;

    var doi = (f.doi || "").replace(/[{}\s]/g, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
    var pdf = safeUrl(f.pdf);
    var url = safeUrl(f.url);
    if (!pdf && /\.pdf($|[?#])/i.test(url)) { pdf = url; url = ""; }

    return {
      key: entry.key,
      authors: formatAuthors(f.author || f.editor),
      title: cleanLatex(f.title),
      venue: formatVenue(entry.type, f),
      details: formatDetails(f),
      year: isNaN(year) ? null : year,
      month: month,
      doi: doi,
      pdf: pdf,
      url: url,
      themes: getThemes(f)
    };
  }

  // Newest first: by year, then month, then title A–Z.
  function sortNewestFirst(a, b) {
    var ya = a.year === null ? -Infinity : a.year;
    var yb = b.year === null ? -Infinity : b.year;
    if (ya !== yb) return yb - ya;
    if (a.month !== b.month) return b.month - a.month;
    return a.title.localeCompare(b.title);
  }


  /* ====================================================================
     PART 4: SHOWING PUBLICATIONS ON THE PAGE
     ==================================================================== */

  var allPublications = [];
  var currentTheme = "all";

  // Small helper to create an element with a class and text.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addPeriod(s) {
    return /[.!?]$/.test(s) ? s : s + ".";
  }

  function renderPublication(pub) {
    var item = el("li", "pub-item");
    var cite = el("p");
    cite.style.margin = "0";

    // Citation: Authors. Title. Venue, details, Year.
    if (pub.authors) cite.appendChild(el("span", "pub-authors", addPeriod(pub.authors)));
    cite.appendChild(el("span", "pub-title", addPeriod(pub.title)));
    cite.appendChild(document.createTextNode(" "));
    if (pub.venue) {
      cite.appendChild(el("span", "pub-venue", pub.venue));
      cite.appendChild(document.createTextNode(", "));
    }
    if (pub.details) cite.appendChild(document.createTextNode(pub.details + ", "));
    cite.appendChild(document.createTextNode((pub.year || "n.d.") + "."));
    item.appendChild(cite);

    // Theme tags and links
    var meta = el("div", "pub-meta");
    pub.themes.forEach(function (id) {
      var theme = THEMES.filter(function (t) { return t.id === id; })[0];
      meta.appendChild(el("span", "pub-tag", theme.label));
    });

    function addLink(label, href, description) {
      var a = el("a", "pub-link", label);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", description + ": " + pub.title + " (opens in a new tab)");
      meta.appendChild(a);
    }
    if (pub.pdf) addLink("PDF", pub.pdf, "PDF");
    if (pub.doi) addLink("DOI", "https://doi.org/" + pub.doi, "DOI");
    if (pub.url) addLink("Link", pub.url, "Web page");

    if (meta.childNodes.length) item.appendChild(meta);
    return item;
  }

  function renderPublications() {
    var container = document.getElementById("publication-list");
    if (!container) return;
    container.innerHTML = "";

    var shown = allPublications.filter(function (pub) {
      return currentTheme === "all" || pub.themes.indexOf(currentTheme) !== -1;
    });

    if (!shown.length) {
      container.appendChild(el("p", "pub-status",
        allPublications.length ? "No publications for this theme yet." : "Publications coming soon."));
      return;
    }

    // Group under a heading for each year
    var list = null;
    var lastYear;
    shown.forEach(function (pub) {
      if (pub.year !== lastYear) {
        container.appendChild(el("h3", "pub-year-heading", pub.year ? String(pub.year) : "Undated"));
        list = el("ul", "pub-list");
        container.appendChild(list);
        lastYear = pub.year;
      }
      list.appendChild(renderPublication(pub));
    });
  }

  function setUpFilters() {
    var buttons = document.querySelectorAll(".filter-btn");
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        currentTheme = button.getAttribute("data-theme");
        buttons.forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === button));
        });
        renderPublications();
      });
    });
  }

  // Get the text of references.bib.
  // - Opened directly from your computer: browsers block reading local
  //   files, so we use the copy that the <script src="references.bib">
  //   tag in index.html already loaded (window.AI4AGING_BIB).
  // - On a web server: either way works; fetch is the fallback.
  function loadBibText() {
    if (typeof window.AI4AGING_BIB === "string") {
      return Promise.resolve(window.AI4AGING_BIB);
    }
    return fetch(BIB_FILE).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    });
  }

  function loadPublications() {
    loadBibText()
      .then(function (text) {
        var result = parseBibTeX(text);
        result.skipped.forEach(function (s) {
          console.warn("[AI4Aging] Skipped a BibTeX entry (" + s.reason + "):\n" + s.snippet);
        });

        allPublications = [];
        result.entries.forEach(function (entry) {
          try {
            allPublications.push(toPublication(entry));
          } catch (err) {
            console.warn("[AI4Aging] Could not display entry \"" + entry.key + "\":", err);
          }
        });
        allPublications.sort(sortNewestFirst);
        renderPublications();
      })
      .catch(function (err) {
        console.error("[AI4Aging] Could not load " + BIB_FILE + ":", err);
        var container = document.getElementById("publication-list");
        if (container) {
          container.innerHTML = "";
          container.appendChild(el("p", "pub-status",
            "Publications could not be loaded right now. Please check back later."));
        }
      });
  }


  /* --------------------------------------------------------------------
     START
     -------------------------------------------------------------------- */
  function start() {
    setUpNavigation();
    updateCopyrightYear();
    setUpFilters();
    loadPublications();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Expose the parser for testing in the browser console (optional).
  window.AI4Aging = { parseBibTeX: parseBibTeX };
})();
