// ==UserScript==
// @name         Persona Creator Finder
// @namespace    persona.creatorfinder
// @version      3.5.3
// @description  Finds AI/tech creators on Instagram/TikTok by median views. 3.5.3 refunds the attempt when a page fails because of throttling, so a rate limit cannot retire good leads.
// @author       Persona
// @match        https://www.tiktok.com/*
// @match        https://tiktok.com/*
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('%c[PCF] script injected on ' + location.href, 'color:#16a34a;font-weight:bold');

  /* ============================================================
     CONFIG - edit these defaults if you like, or use the panel
     ============================================================ */
  const DEFAULTS = {
    minAvgViews: 50000,      // the hard criterion
    minFollowers: 0,         // 0 = no floor. Small accounts with big views qualify.
    maxFollowers: 0,         // 0 = no ceiling
    scrollDelayMin: 1800,    // ms between scroll steps (randomised)
    scrollDelayMax: 3600,
    profileDelayMin: 6000,   // ms between profile visits
    profileDelayMax: 11000,
    scrollsPerTag: 25,       // how far down each hashtag page to go
    maxProfilesPerRun: 40,   // stop after this many profile visits
    minRelevance: 0,
    minSample: 6,           // need >= this many sampled post views before a lead can qualify
    harvestComments: false, // 3.3.0 - off by default. Commenters qualified at 3.5% vs 15.4% for posters
    enrichComments: false   // 3.3.0 - keep commenter leads out of the enrich queue
  };

  // Words that say "this is an AI/tech creator". Handle, caption and bio are scored.
  const GOOD = ['ai','a.i','gpt','chatgpt','claude','gemini','llm','agent','automat',
    'n8n','make.com','zapier','nocode','no-code','lowcode','prompt','jarvis','copilot',
    'cursor','vibecode','saas','software','tech','build','developer','coding','code',
    'workflow','productivity','tools','startup','founder','systems',
    // 3.2.1 - widened for the productivity / student / gadget / solopreneur
    // verticals. Without these, creators from the new tags score 0 on
    // relevance and get filtered out before they are ever enriched.
    'notion','obsidian','secondbrain','second brain','planner','organize','organis',
    'timeblock','time block','deepwork','deep work','focus','habit','routine',
    'todo','to-do','task','calendar','schedul','inbox zero','getting things done',
    'gtd','studygram','studytok','study','student','revision','notetaking','notes',
    // 3.3.3 - 'edc', 'everydaycarry' and 'unbox' removed. They scored pocket-knife
    // and flashlight accounts as good matches. 'wearable' and 'smartwatch' stay,
    // those are Persona's own hardware category.
    'gadget','wearable','smartwatch','smart ring','tech review','solopreneur','entrepreneur','smallbusiness',
    'buildinpublic','build in public','sidehustle','side hustle','freelance',
    /* 3.5.0 - the five personas. These creators will not use AI vocabulary at
       all, so without this block they score 0 and never reach enrichment.
       Everything short or common here is also listed in STRICT below, so
       'mom' cannot match 'moment' and 'md' cannot match 'admin'.          */
    // professions with demanding schedules
    'nurse','doctor','physician','resident','residency','surgeon','dentist',
    'lawyer','attorney','paralegal','biglaw','law school','teacher','realtor',
    'real estate agent','recruiter','consultant','accountant','therapist',
    // the life-admin load itself
    'admin','paperwork','appointment','scheduling','reschedul','insurance',
    'claim','refund','deposit','invoice','follow up','follow-up','errand',
    'on hold','hold music','customer service','dmv','billing','renewal',
    'subscription','cancel','dispute','voicemail','inbox',
    // the feeling they describe
    'overwhelm','burnout','burned out','mental load','juggling','chaos',
    'drowning','forgot','forgetting','procrastinat','executive function',
    'adhd','neurodivergent','time management','work life balance',
    // family and corporate
    'mom','mum','parent','working mom','family','childcare','daycare',
    'corporate','9 to 5','nine to five','back to back','meetings','office job',
    'career','promotion','manager'];

  // Words that mean it slipped in from a broad tag. Sports, crypto pumps, general media.
  const BAD = ['nba','nfl','basketball','football','soccer','highlights','sports','espn',
    'nascar','wwe','ufc','recipe','makeup','skincare','fashion','outfit','asmr','prank',
    'meme page','fan page','fanpage','edits','anime edit','crypto signal','pump','forex',
    // 3.3.3 - the everyday-carry community. Huge and hyperactive on Instagram so
    // it floods the post queue, and it is the wrong audience for an app-first
    // launch. Each hit is -3, so these go clearly negative and Prune removes them.
    'edc','everydaycarry','everyday carry','pocketdump','pocket dump','edcgear',
    'flashlight','multitool','multi-tool','knife','knive','olight','tactical',
    'edcknife','edccarry','loadout','pocket knife'];

  // 3.3.0 - these are too short to match as substrings. Scored against a
  // normalised copy where every non-letter becomes a space, so "ai" hits
  // "davi.rmx.ai" and "nocode2ai" but not "rohitjain", "ubaid", "mkaif",
  // "shoaib" or "vaibhav". Substring matching on "ai" alone was manufacturing
  // roughly 500 false positives out of ordinary personal names.
  const STRICT = new Set(['ai','a i','gpt','llm','bot','agent','agents','tech',
                          'build','builds','code','codes','ml','cs','task','tasks',
                          'notes','focus','study','tool','tools','edc','gtd',
                          'review','reviews','unbox','habit','habits','routine',
                          // 3.5.0 - short or common enough to produce false
                          // positives as substrings. 'mom' in 'moment',
                          // 'claim' in 'reclaimed', 'admin' in everything.
                          'mom','mum','parent','family','nurse','doctor','lawyer',
                          'teacher','realtor','recruiter','consultant','accountant',
                          'therapist','resident','surgeon','dentist','attorney',
                          'admin','claim','refund','deposit','invoice','errand',
                          'cancel','dispute','inbox','billing','renewal','career',
                          'manager','meetings','chaos','forgot','adhd','burnout',
                          'corporate','office job','promotion','paperwork']);

  function normWords(t) { return ' ' + t.replace(/[^a-z]+/g, ' ').trim() + ' '; }

  function scoreRelevance(L) {
    const raw = ((L.handle || '') + ' ' + (L.name || '') + ' ' +
                 (L.bio || '') + ' ' + (L.captions || '')).toLowerCase();
    if (!raw.trim()) return 0;
    const words = normWords(raw);
    let score = 0;
    GOOD.forEach(k => {
      const hit = STRICT.has(k) ? words.indexOf(' ' + k.replace(/[^a-z ]/g,'') + ' ') !== -1
                                : raw.indexOf(k) !== -1;
      if (hit) score += 1;
    });
    BAD.forEach(k => { if (raw.indexOf(k) !== -1) score -= 3; });
    return score;
  }

  /* 3.3.0 - where a lead came from predicts whether it is worth a visit far
     better than its relevance score does. Measured on 499 enriched leads:
       ig post       324 visited -> 50 qualified   15.4%
       ig commenter  170 visited ->  6 qualified    3.5%
       suggested       3 visited ->  0 qualified    0.0%
     Commenters were 88% of the pool and a quarter as productive. */
  function leadSource(L) {
    const fv = (L.foundVia || '').toLowerCase();
    if (fv.indexOf('ig commenter') === 0) return 'commenter';
    if (fv.indexOf('ig post') === 0) return 'post';
    if (fv.indexOf('suggested') === 0) return 'peer';
    if (fv.indexOf('seeded from tiktok') === 0) return 'post';
    return 'other';
  }
  const SOURCE_RANK = { post: 0, other: 1, peer: 2, commenter: 3 };

  /* 3.5.0 - rebuilt around the five Persona ad personas rather than the AI
     ecosystem. The bet: people with demanding jobs and real life-admin loads
     have large audiences, no AI-sponsor competition bidding their rates up,
     and they demonstrate the product in a life rather than in a workflow.
     Ordered by persona so a partial run still gives a readable sample.     */
  const TAGS = [
    // Maya - the sorry-email sender. Knowledge workers drowning in admin.
    'adhdtiktok', 'adhdproductivity', 'executivedysfunction', 'neurodivergent',
    'adhdinwomen', 'overwhelmed', 'burnout',
    // Rachel - the family COO. The mental load.
    'workingmom', 'momtok', 'momsoftiktok', 'mentalload', 'momhacks',
    'familyorganization', 'momceo',
    // Marcus - the solo operator. Freelancers, agencies, small business.
    'solopreneur', 'freelancelife', 'smallbusinesstiktok', 'agencyowner',
    'realtorlife', 'smallbusinessowner', 'entrepreneurlife',
    // Sam - the red-tape hostage. Insurance, disputes, refunds, admin.
    'lifeadmin', 'adulting', 'consumerrights', 'insurancetips', 'medicalbilling',
    // Erin - the no-EA executive. Corporate, back to back meetings.
    'corporatetiktok', 'corporatelife', '9to5', 'careertok', 'worklife',
    'consultinglife',
    // The professions named directly: demanding schedules, big audiences.
    'nursesoftiktok', 'nurselife', 'doctorsoftiktok', 'medtok', 'residency',
    'lawtok', 'lawyersoftiktok', 'lawstudent', 'biglaw', 'teachertok',
    'medstudent', 'gradschool',
    // Kept from the previous pass - adjacent and already proven to produce.
    'productivityhacks', 'productivitytips', 'timeblocking', 'studytok'
  ];

  // Instagram killed hashtag pages; keyword search is what's left, and it
  // returns posts only. These are the queries the IG search pass walks.
  // 3.2.2 - ORDER MATTERS. The resolve + enrich steps will never chew through
  // the whole post queue, so whatever sits at the FRONT is all that actually
  // gets processed. New verticals lead; the saturated AI-agent cluster (which
  // has already been mined and mostly emailed) trails.
  const IG_QUERIES = [
    // new territory - unmonetized verticals, run these first
    'productivity hacks', 'productivity tips', 'notion template', 'second brain',
    'time blocking', 'deep work', 'digital planner', 'study with me',
    'student productivity', 'med student',
    // 3.3.2 - 'everyday carry' and 'edc gear' removed. They were a bet on the
    // wearable, but the launch is app-first and slipped for app development,
    // so an EDC creator has nothing physical to hold up. Revisit when hardware
    // ships. The gadget queries stay: they cover AI hardware (Rabbit R1 etc).
    'tech gadgets', 'wearable tech', 'gadget review', 'solopreneur',
    'founder life', 'build in public', 'small business owner',
    // already mined - kept only as overflow
    'ai assistant', 'ai automation', 'ai agent', 'jarvis ai', 'claude ai',
    'chatgpt tips', 'ai tools', 'build with ai', 'ai workflow', 'n8n automation',
    'ai productivity', 'personal ai', 'vibe coding', 'ai for business'
  ];

  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // 3.3.1 - more than this and the tail will never be reached anyway.
  const POSTQ_CAP = 4000;

  /* ============================================================
     STATE - persisted across page navigations
     ============================================================ */
  let storageFailed = false;
  const S = {
    get: (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } },
    set: (k, v) => {
      try { GM_setValue(k, v); storageFailed = false; return true; }
      catch (e) { storageFailed = true; console.error('[PCF] storage write FAILED for', k, e); return false; }
    },
    del: (k) => { try { GM_deleteValue(k); } catch (e) {} }
  };

  let cfg      = S.get('cfg', DEFAULTS);
  let leads    = S.get('leads', {});      // handle -> record
  let queue    = S.get('queue', []);      // profile URLs waiting to be enriched
  let tagQueue = S.get('tagQueue', []);   // hashtag pages waiting to be walked
  let postQueue = S.get('postQueue', []); // IG /p/ urls waiting to be resolved to handles
  let qQueue   = S.get('qQueue', []);     // IG search queries waiting to be walked
  let mode     = S.get('mode', 'idle');   // idle | tags | profiles
  let visited  = S.get('visited', []);    // profile URLs already navigated to this run
  let attempts = S.get('attempts', {});   // 3.5.2 url -> attempt count, kept OUT of the
                                          // leads blob so it survives a quota failure the
                                          // same way `visited` does. Without this, a full
                                          // store would reset every counter on reload and
                                          // the retry logic would loop instead of retire.
  /* 3.4.0 ------------------------------------------------------------------
     Every lead now carries the batch it arrived in and the query that found
     it. Two reasons. First, the enrich queue sorts newest batch first, so a
     fresh night's leads are visited before the aged backlog - previously the
     backlog had higher relevance scores and swallowed every run, and three
     consecutive nights of new leads were never visited at all. Second, per
     query provenance makes it measurable which searches produce creators who
     qualify, instead of guessing at verticals.                            */
  let batch    = S.get('batch', 0);       // increments once per Auto Run
  let curQuery = S.get('curQuery', '');   // search term currently being walked
  let auto     = S.get('auto', null);     // null, or { stage, postTarget }
  let stats    = S.get('stats', { scanned: 0, profiles: 0, qualified: 0 });
  let failStreak = 0;

  /* ---- 3.2.1: never visit the same profile twice in one run -------------
     A dead profile that fails to render cannot be marked enriched from its
     own page, so it used to float back into every rebuilt queue and the pass
     span on it forever. This is the hard backstop: the URL is recorded
     BEFORE we navigate, so it holds even if the page never runs the script. */
  const VISIT_CAP = 3000;
  function normUrl(u) {
    if (!u) return '';
    let t = String(u).split('?')[0].split('#')[0];
    t = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return t.toLowerCase();
  }
  function visitedHas(u) { const n = normUrl(u); return !!n && visited.indexOf(n) !== -1; }

  /* 3.5.2 -------------------------------------------------------------------
     markVisited fires BEFORE we navigate (3.2.1, to kill the refresh loop).
     That means any lead whose page never loaded - failed navigation, throttle,
     soft error shell, a run stopped mid-flight - was stamped into `visited`
     while still unenriched, and `visited` persists across runs. The queue
     build then excluded it forever. It was never retried and never exported
     with a reason. So: `visited` no longer retires a lead on its own. Two
     real attempts do.
     ------------------------------------------------------------------------- */
  const MAX_TRIES = 2;
  let urlIndex = null;
  function buildUrlIndex() {
    urlIndex = Object.create(null);
    for (const k in leads) {
      const n = normUrl(leads[k].profileUrl);
      if (n) urlIndex[n] = k;
    }
  }
  function leadByUrl(u) {
    if (!urlIndex) buildUrlIndex();
    const n = normUrl(u);
    return (n && urlIndex[n]) ? leads[urlIndex[n]] : null;
  }
  const ATTEMPT_CAP = 6000;
  function triesFor(u) {
    const n = normUrl(u);
    const L = leadByUrl(u);
    return Math.max((L && L.tries) || 0, (n && attempts[n]) || 0);
  }
  function exhausted(u) {
    const L = leadByUrl(u);
    if (!L) return true;                       // no lead behind it, nothing to retry
    return !!L.enriched || triesFor(u) >= MAX_TRIES;
  }
  function bumpTries(u) {
    const n = normUrl(u);
    if (!n) return;
    const t = triesFor(u) + 1;
    attempts[n] = t;
    const L = leadByUrl(u);
    if (L && !L.enriched) {
      L.tries = t;
      if (t >= MAX_TRIES) {
        L.enriched = true; L.dead = true;
        L.foundVia = (L.foundVia || '') + ' [no data x' + MAX_TRIES + ']';
      }
    }
    const keys = Object.keys(attempts);
    if (keys.length > ATTEMPT_CAP) delete attempts[keys[0]];
  }

  /* 3.5.3 -------------------------------------------------------------------
     The attempt is counted at mark time, before we know why a page failed. A
     rate limit is not the lead's fault, so when we land on a block page we
     hand the attempt back and un-retire the lead before stopping. Otherwise a
     throttle silently retires every profile it touches as [no data x2].
     ------------------------------------------------------------------------- */
  function refundTry(u) {
    const n = normUrl(u);
    if (!n) return;
    if (attempts[n]) attempts[n] = Math.max(0, attempts[n] - 1);
    const L = leadByUrl(u);
    if (L && L.dead) {
      L.tries = attempts[n] || 0;
      L.enriched = false; L.dead = false;
      L.foundVia = (L.foundVia || '').replace(/ \[no data x\d+\]/g, '');
    } else if (L) {
      L.tries = attempts[n] || 0;
    }
    const i = visited.indexOf(n);
    if (i !== -1) visited.splice(i, 1);
  }

  function reviveDead() {
    let n = 0;
    for (const k in leads) {
      const L = leads[k];
      if (L.dead && !L.medianViews) {
        L.enriched = false; L.dead = false; L.tries = 0;
        L.foundVia = (L.foundVia || '').replace(/ \[no data x\d+\]/g, '');
        const u = normUrl(L.profileUrl);
        if (u) { delete attempts[u]; const i = visited.indexOf(u); if (i !== -1) visited.splice(i, 1); }
        n++;
      }
    }
    return n;
  }
  function orphanCount() {
    let n = 0;
    for (const k in leads) {
      const L = leads[k];
      if (!L.enriched && triesFor(L.profileUrl) < MAX_TRIES && visitedHas(L.profileUrl)) n++;
    }
    return n;
  }
  function markVisited(u) {
    const n = normUrl(u);
    if (!n || visited.indexOf(n) !== -1) return;
    visited.push(n);
    while (visited.length > VISIT_CAP) visited.shift();
  }

  // Writing the whole lead set on every DOM mutation ground the page to a halt
  // once we were a few hundred leads deep. Throttle it, and force a write
  // immediately before any navigation so nothing is lost.
  let saveDirty = false, lastSave = 0;
  const SAVE_EVERY = 2500;

  const saveNow = () => {
    // Small, critical state first. If the big leads blob blows the quota,
    // we still keep our place in the queue.
    S.set('queue', queue); S.set('mode', mode); S.set('stats', stats); S.set('cfg', cfg);
    S.set('tagQueue', tagQueue); S.set('postQueue', postQueue); S.set('qQueue', qQueue);
    S.set('visited', visited);
    S.set('attempts', attempts);
    S.set('batch', batch); S.set('curQuery', curQuery); S.set('auto', auto);
    S.set('leads', leads);
    lastSave = Date.now(); saveDirty = false;
  };

  const save = () => {
    saveDirty = true;
    if (Date.now() - lastSave > SAVE_EVERY) saveNow();
  };

  setInterval(() => { if (saveDirty) saveNow(); }, SAVE_EVERY);
  window.addEventListener('beforeunload', () => { try { saveNow(); } catch (e) {} });

  const site = location.hostname.includes('tiktok') ? 'tiktok' : 'instagram';
  const rnd  = (a, b) => Math.floor(a + Math.random() * (b - a));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /* ============================================================
     HELPERS
     ============================================================ */

  // "1.2M" -> 1200000, "45.6K" -> 45600, "1,234" -> 1234
  function parseCount(txt) {
    if (!txt) return null;
    const m = String(txt).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    if (suf === 'M') n *= 1e6;
    if (suf === 'B') n *= 1e9;
    return Math.round(n);
  }

  function median(arr) {
    const a = arr.filter(x => typeof x === 'number' && x > 0).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
  }

  /* 3.5.1 - TikTok intermittently serves a "Something went wrong" shell in
     place of a profile. Clicking its retry button loads the real page, so it
     is a transient render failure, not a block. Without this the profile
     looked empty, got written off as dead, and a perfectly good lead was
     burned permanently. */
  function softErrorPage() {
    const t = (document.body ? document.body.innerText : '').slice(0, 1500).toLowerCase();
    if (t.length > 1200) return false;   // a real page has more text than this
    return /something went wrong|try again|refresh the page|reload the page/.test(t);
  }

  // Detect rate limiting / captcha / login walls so we stop instead of hammering
  function isBlocked() {
    // A real block page is a near-empty page. A working page full of AI captions
    // will mention "rate limit" and "captcha" constantly, so keyword-scanning the
    // whole body was producing false positives on the exact content we harvest.

    // 1. If the post/profile data we came for is present, we are plainly not blocked.
    const md = document.querySelector('meta[name="description"]');
    if (md && md.content && md.content.length > 40) return false;
    const main = document.querySelector('main');
    if (main && main.innerText && main.innerText.length > 2000) return false;

    // 2. Otherwise: only a short, contentless page counts as a block.
    const t = document.body ? document.body.innerText.slice(0, 4000).toLowerCase() : '';
    if (t.length > 1500) return false;
    return /too many requests|unusual activity|verify you'?re human|please wait a few minutes|temporarily blocked|try again later|couldn'?t refresh feed/.test(t);
  }

  // Post pages need several seconds. Poll for the meta description that carries
  // the author handle instead of guessing with a flat delay.
  async function waitForPostData(ms) {
    const deadline = Date.now() + (ms || 12000);
    while (Date.now() < deadline) {
      const md = document.querySelector('meta[name="description"]');
      if (md && md.content && /\son\s/.test(md.content)) return true;
      await wait(500);
    }
    return false;
  }

  // The old slash-stripping bug produced handles of the form
  //   <real handle> + <instagram sub-path> [+ <post id>]
  // e.g. /nocodealex/tagged/        -> "nocodealextagged"
  //      /promptbuildclub/p/DDeyV../ -> "promptbuildclubpddeyvdtjezz"
  // Rather than guessing at suffix patterns, decompose: if some prefix of the
  // handle is itself a handle we know, and the remainder starts with a real
  // sub-path word, it is welded.
  const IG_SUBPATH = ['tagged','reposts','repost','followers','following','saved',
                      'highlights','guides','channel','reels','reel','feed','tv','p','stories','live'];
  // These can legitimately end a username, so they only count when the stem is
  // a handle we have actually seen.
  const SUBPATH_LOOSE = new Set(['tagged','reposts','repost','followers','following','highlights']);

  function looksWelded(h, known) {
    if (!h || h.length < 5) return false;
    // handle + sub-path + post id, where the id is a long alphanumeric run
    if (/(reel|reels|tagged|stories|followers|following)[a-z0-9_-]{8,}$/i.test(h)) return true;
    for (let i = 3; i < h.length - 1; i++) {
      const stem = h.slice(0, i);
      const rest = h.slice(i);
      for (const sp of IG_SUBPATH) {
        if (!rest.startsWith(sp)) continue;
        const tail = rest.slice(sp.length);
        // tail is either empty (/user/tagged/) or a post id (/user/p/ABC123/)
        if (tail.length && !/^[a-z0-9_-]{8,14}$/.test(tail)) continue;
        if (known && known.has(stem)) return true;
        if (!tail.length && !SUBPATH_LOOSE.has(sp)) continue;
        if (!tail.length && SUBPATH_LOOSE.has(sp)) return true;
      }
    }
    return false;
  }

  function addLead(handle, patch) {
    if (!handle) return;
    handle = handle.replace(/^@/, '').trim().toLowerCase();
    if (!handle || handle.length > 40) return;
    // Last line of defence: never let a site route become a lead.
    if (site === 'instagram' && (IG_RESERVED.has(handle) || /^explore|^accounts|^direct/.test(handle))) return;
    // A path fragment that got flattened into a handle, e.g. "user" + "tagged".
    if (site === 'instagram' && looksWelded(handle, new Set(Object.keys(leads)))) return;
    if (!leads[handle]) {
      leads[handle] = {
        handle, platform: site, followers: null, medianViews: null,
        postViews: [], bio: '', email: '', link: '', name: '', captions: '', relevance: 0,
        profileUrl: site === 'tiktok'
          ? `https://www.tiktok.com/@${handle}`
          : `https://www.instagram.com/${handle}/reels/`,
        enriched: false, qualified: false, foundVia: patch && patch.foundVia || '',
        batch: batch, query: curQuery
      };
      stats.scanned++;
    }
    Object.assign(leads[handle], patch || {});
    const L = leads[handle];
    if (L.postViews && L.postViews.length >= 3) L.medianViews = median(L.postViews);
    L.relevance = scoreRelevance(L);
    L.qualified = qualifies(L);
  }

  function qualifies(L) {
    if (cfg.minRelevance && (L.relevance || 0) < cfg.minRelevance) return false;
    // minimum sample: a median off 2 posts is noise, not a rate basis
    const sample = (L.postViews || []).length;
    if (sample < (cfg.minSample || 6)) return false;
    if (!L.medianViews || L.medianViews < cfg.minAvgViews) return false;
    if (cfg.minFollowers && (L.followers || 0) < cfg.minFollowers) return false;
    if (cfg.maxFollowers && (L.followers || 0) > cfg.maxFollowers) return false;
    return true;
  }

  /* ============================================================
     HARVESTERS - read what's rendered on the current page
     ============================================================ */

  function harvestTikTokFeed() {
    // VERIFIED 2026-09: TikTok tag pages expose challenge-item-avatar /
    // -username / -desc only. There are NO view counts on tag pages, so we
    // collect handles here and get all the numbers during the profile pass.
    const items = document.querySelectorAll(
      '[data-e2e="challenge-item"], [data-e2e="search_top-item"], [data-e2e="search_video-item"], div[class*="DivItemContainer"]'
    );
    items.forEach(it => {
      // handle link is sometimes inside the tile, sometimes wraps it
      const a = it.querySelector('a[href*="/@"]') || it.closest('a[href*="/@"]');
      if (!a) return;
      const m = (a.getAttribute('href') || '').match(/\/@([^\/?]+)/);
      if (!m) return;
      const handle = m[1];

      let views = null;
      const v = it.querySelector('[data-e2e="video-views"], strong[class*="StrongVideoCount"], [class*="video-count"]');
      if (v) views = parseCount(v.textContent);

      const d = it.querySelector('[data-e2e="challenge-item-desc"], [data-e2e="search-card-video-caption"]');
      const cap = d ? d.textContent.trim().slice(0, 160) : '';
      const prev = leads[handle.toLowerCase()];
      addLead(handle, {
        foundVia: location.pathname,
        captions: ((prev && prev.captions ? prev.captions + ' ' : '') + cap).slice(0, 400)
      });
      if (views) {
        const L = leads[handle.toLowerCase()];
        if (L && L.postViews.length < 12 && !L.postViews.includes(views)) {
          L.postViews.push(views);
          L.medianViews = median(L.postViews);
          L.qualified = qualifies(L);
        }
      }
    });
  }

  // VERIFIED 2026-09 against a live profile: followers-count, user-bio (emails
  // live here), user-link and video-views all resolve correctly.
  function harvestTikTokProfile() {
    const m = location.pathname.match(/^\/@([^\/?]+)/);
    if (!m) return;
    const handle = m[1];

    const fEl = document.querySelector('[data-e2e="followers-count"]');
    const followers = fEl ? parseCount(fEl.textContent) : null;

    const bioEl = document.querySelector('[data-e2e="user-bio"]');
    const bio = bioEl ? bioEl.textContent.trim() : '';

    const nameEl = document.querySelector('[data-e2e="user-subtitle"], [data-e2e="user-title"]');
    const name = nameEl ? nameEl.textContent.trim() : '';

    const linkEl = document.querySelector('[data-e2e="user-link"] a, a[data-e2e="user-link"]');
    const link = linkEl ? (linkEl.href || linkEl.textContent.trim()) : '';

    // Emails: bio text, plus anything visible in the header area
    const headerTxt = (document.querySelector('[data-e2e="user-page"], header') || document.body).innerText || '';
    const emails = (bio + ' ' + headerTxt).match(EMAIL_RE) || [];
    const email = emails.length ? emails[0] : '';

    // Recent post view counts from the profile grid
    const views = [];
    document.querySelectorAll('[data-e2e="user-post-item"] [data-e2e="video-views"], [data-e2e="video-views"]').forEach(v => {
      const n = parseCount(v.textContent);
      if (n) views.push(n);
    });

    addLead(handle, {
      followers, bio, name, link, email,
      postViews: views.slice(0, 12),
      medianViews: median(views.slice(0, 12)),
      enriched: true
    });

    // Peer discovery: TikTok shows related creators on a profile. These are
    // vetted-by-association and include people who never use hashtags.
    document.querySelectorAll(
      '[data-e2e="suggest-account-item"] a[href*="/@"], [data-e2e="recommend-card"] a[href*="/@"], aside a[href*="/@"]'
    ).forEach(a => {
      const mm = (a.getAttribute('href') || '').match(/\/@([^\/?]+)/);
      if (mm && mm[1].toLowerCase() !== handle.toLowerCase()) {
        addLead(mm[1], { foundVia: 'suggested:' + handle });
      }
    });
  }

  // VERIFIED 2026-09: Instagram search grids expose posts as /p/<id>/ with NO
  // username anywhere in the markup. So we can't get handles here. We collect
  // the post URLs and resolve each one to its author in a second pass.
  function harvestInstagramSearch() {
    let added = 0;
    document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (!m) return;
      const url = `https://www.instagram.com/${m[1]}/${m[2]}/`;
      // 3.3.1 - hard cap. The queue had reached 13,636 entries, far beyond
      // what the resolve pass can ever work through, and because it is FIFO
      // everything newly collected sat behind thousands of stale URLs.
      if (postQueue.length >= POSTQ_CAP) return;
      if (!postQueue.includes(url) && !S.get('seenPost:' + m[2], false)) {
        postQueue.push(url); added++;
      }
    });
    if (added) log(`+${added} posts queued (${postQueue.length} total)`);
  }

  // VERIFIED 2026-09: a post page's meta description reads
  // "15K likes, 5,252 comments - nick_saraev on March 30, 2025: ..."
  // which gives us the author handle, the engagement, and the caption.
  // Instagram reserved paths. Anything here is a site route, not a person.
  const IG_RESERVED = new Set(['explore','reels','reel','direct','accounts','stories','p','tv',
    'channels','popular','about','legal','api','developer','directory','emails','session',
    'challenge','oauth','graphql','ajax','web','your_activity','tags','locations','topics',
    'lite','igtv','help','press','privacy','terms','sitemap','create','archive','saved']);

  // Turn an href into a username, or null. A profile URL has EXACTLY one path
  // segment: /nick_saraev/. Anything deeper (/explore/tags/aiagents/) is a site
  // route and must never be flattened into a handle.
  function handleFromHref(href) {
    if (!href) return null;
    let path = href;
    try { path = new URL(href, location.origin).pathname; } catch (e) {}
    const seg = path.split('?')[0].split('#')[0].split('/').filter(Boolean);
    if (seg.length !== 1) return null;
    const h = seg[0];
    if (!/^[a-zA-Z0-9._]{2,30}$/.test(h)) return null;
    if (IG_RESERVED.has(h.toLowerCase())) return null;
    return h;
  }

  // The page also links every commenter, which is a free second source.
  function harvestInstagramPost() {
    const md = document.querySelector('meta[name="description"]');
    const og = document.querySelector('meta[property="og:title"]');
    const desc = md ? md.content : '';
    const title = og ? og.content : '';

    let handle = null;
    const hm = desc.match(/-\s*([A-Za-z0-9._]+)\s+on\s/);
    if (hm) handle = hm[1];
    if (!handle) {
      const tm = title.match(/^(.+?)\s+on Instagram/);
      if (tm) {
        const link = document.querySelector('main a[href^="/"][href$="/"]');
        if (link) handle = handleFromHref(link.getAttribute('href'));
      }
    }

    const caption = (title || desc).slice(0, 200);
    let likes = null;
    const lm = desc.match(/([\d.,]+\s*[KMB]?)\s+likes/i);
    if (lm) likes = parseCount(lm[1]);

    if (handle) {
      const prev = leads[handle.toLowerCase()];
      addLead(handle, {
        foundVia: 'ig post',
        captions: ((prev && prev.captions ? prev.captions + ' ' : '') + caption).slice(0, 400)
      });
    }

    // 3.3.0 - commenter harvesting is OFF unless explicitly switched on.
    // It was producing 88% of the lead volume at a quarter of the hit rate,
    // and those leads have no bio or captions so they get scored on username
    // alone, which is where the false positives came from.
    if (cfg.harvestComments) {
      document.querySelectorAll('main a[href^="/"]').forEach(a => {
        const h = handleFromHref(a.getAttribute('href'));
        if (h && (!handle || h.toLowerCase() !== handle.toLowerCase())) {
          addLead(h, { foundVia: 'ig commenter' });
        }
      });
    }

    const idm = location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    if (idm) S.set('seenPost:' + idm[1], true);
  }

  // VERIFIED 2026-09 against a live profile.
  // Instagram does NOT expose view counts on the main profile grid, only on the
  // /reels/ tab, and only after scrolling triggers lazy load. Followers are not
  // in a span[title] any more either, so we regex them out of the header text.
  function harvestInstagramProfile() {
    const m = location.pathname.match(/^\/([^\/]+)\/?(reels\/?)?$/);
    if (!m) return;
    const handle = m[1];
    if (['explore','reels','direct','accounts','stories','p'].includes(handle)) return;

    const main = document.querySelector('main') || document.body;
    const txt  = main.innerText || '';

    // "201K followers" / "1,431 posts | 201K followers | 999 following"
    let followers = null;
    const fm = txt.match(/([\d.,]+\s*[KMB]?)\s+followers/i);
    if (fm) followers = parseCount(fm[1]);
    if (!followers) {
      const md = document.querySelector('meta[name="description"]');
      if (md) {
        const mm = md.content.match(/([\d.,]+\s*[KMB]?)\s+Followers/i);
        if (mm) followers = parseCount(mm[1]);
      }
    }

    // Everything after "following" in the header block is bio-ish
    let bio = '';
    const bi = txt.toLowerCase().indexOf('following');
    if (bi > -1) bio = txt.slice(bi + 9, bi + 700).trim();
    else bio = txt.slice(0, 500);

    const emails = (txt.match(EMAIL_RE) || []).filter(e => !/instagram|facebook|fbcdn/i.test(e));
    const email = emails.length ? emails[0] : '';

    let link = '';
    const la = document.querySelector('main a[href^="http"]:not([href*="instagram.com"]), header a[href^="http"]:not([href*="instagram.com"])');
    if (la) link = la.href;

    // View counts live in the innerText of each /reel/ tile on the reels tab
    const views = [];
    document.querySelectorAll('a[href*="/reel/"]').forEach(a => {
      const t = (a.innerText || '').trim();
      if (!t) return;
      const n = parseCount(t.split('\n')[0]);
      if (n && n > 50) views.push(n);
    });

    addLead(handle, {
      followers, bio: bio.slice(0, 500), email, link,
      postViews: views.slice(0, 12),
      medianViews: median(views.slice(0, 12)),
      enriched: views.length > 0 || !!followers
    });

    // Peer discovery: IG suggests similar accounts on profile pages.
    // Must go through handleFromHref, which only accepts single-segment paths.
    // The old slash-stripping turned /user/reel/ABC123/ into "userreelABC123".
    document.querySelectorAll('main a[href^="/"]').forEach(a => {
      const h = handleFromHref(a.getAttribute('href'));
      if (h && h.toLowerCase() !== String(handle || '').toLowerCase()) {
        addLead(h, { foundVia: 'suggested:' + handle });
      }
    });
  }

  function harvestCurrentPage() {
    try {
      if (site === 'tiktok') {
        if (/^\/@/.test(location.pathname)) harvestTikTokProfile();
        else harvestTikTokFeed();
      } else {
        if (/\/(p|reel)\//.test(location.pathname)) harvestInstagramPost();
        else if (/^\/[^\/]+\/(reels\/?)?$/.test(location.pathname) &&
                 !/^\/(explore|reels|direct|accounts)/.test(location.pathname)) harvestInstagramProfile();
        else if (mode === 'igsearch') harvestInstagramSearch();
      }
      save(); render();
    } catch (e) { console.warn('[PCF] harvest error', e); }
  }

  /* ============================================================
     AUTOMATION
     ============================================================ */
  let running = false;

  async function scrollAndHarvest(steps) {
    for (let i = 0; i < steps && running; i++) {
      if (isBlocked()) { stop('Instagram is blocking or rate limiting. Wait a few hours.'); return; }
      window.scrollBy({ top: window.innerHeight * (0.7 + Math.random() * 0.5), behavior: 'smooth' });
      await wait(rnd(cfg.scrollDelayMin, cfg.scrollDelayMax));
      harvestCurrentPage();
      log(`Scrolling ${i + 1}/${steps} · ${Object.keys(leads).length} handles`);
    }
  }

  function tagUrl(tag) {
    return site === 'tiktok'
      ? `https://www.tiktok.com/tag/${tag}`
      : `https://www.instagram.com/explore/tags/${tag}/`;
  }

  function currentTag() {
    const m = location.pathname.match(/\/tag\/([^\/?]+)|\/explore\/tags\/([^\/?]+)/);
    return m ? (m[1] || m[2] || '').toLowerCase() : null;
  }

  async function runTagPass() {
    mode = 'tags'; running = true; save();
    if (!tagQueue.length) {
      tagQueue = TAGS.slice();
      // Drop the tag we're already sitting on so we don't scrape it twice
      const cur = currentTag();
      if (cur) tagQueue = tagQueue.filter(t => t.toLowerCase() !== cur);
    }
    save();
    await scrollAndHarvest(cfg.scrollsPerTag);
    if (!running) return;
    // 3.5.0 - in an Auto Run, stop collecting once we have more handles than
    // a night of enrichment can get through.
    if (auto && unenrichedCount() >= AUTO_TAG_TARGET) {
      log(`AUTO · handle target reached (${unenrichedCount()} unenriched).`);
      autoAdvance('tags'); return;
    }
    const next = tagQueue.shift();
    save();
    if (next) {
      log(`Next tag: #${next} · ${tagQueue.length} tags left · ${Object.keys(leads).length} handles`);
      saveNow();
      await wait(rnd(2500, 5000));
      location.href = tagUrl(next);
    } else if (auto) {
      log(`AUTO · all tags walked, ${Object.keys(leads).length} handles.`);
      autoAdvance('tags');
    } else {
      log('Tag pass complete. Switch to Enrich Profiles.');
      mode = 'idle'; running = false; save(); render();
    }
  }

  // Poll until the profile data actually renders. TikTok profiles can take
  // 5-8s; harvesting at 2s was why most profiles came back empty.
  async function waitForProfileData(maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (site === 'tiktok') {
        const f = document.querySelector('[data-e2e="followers-count"]');
        const v = document.querySelectorAll('[data-e2e="video-views"]').length;
        if (f && f.textContent.trim() && v > 0) return true;
      } else {
        const t = (document.querySelector('main') || document.body).innerText || '';
        if (/followers/i.test(t)) return true;
      }
      if (isBlocked()) return false;
      await wait(500);
    }
    return false;
  }

  // PASS 1: walk Instagram keyword searches, collecting post URLs.
  async function runIgSearchPass() {
    mode = 'igsearch'; running = true; save();
    if (!qQueue.length) qQueue = IG_QUERIES.slice();
    save();
    await scrollAndHarvest(cfg.scrollsPerTag);
    if (!running) return;
    // 3.4.0 - in an Auto Run, stop searching once we have more posts than the
    // resolve stage can consume. Collecting 13,000 posts only buried the good
    // ones behind a backlog nothing would ever reach.
    if (auto && postQueue.length >= AUTO_POST_TARGET) {
      log(`AUTO · post target reached (${postQueue.length}).`);
      autoAdvance('search'); return;
    }
    const next = qQueue.shift();
    if (next) curQuery = next;
    saveNow();
    if (next) {
      log(`Next search: "${next}" · ${qQueue.length} left · ${postQueue.length} posts queued`);
      await wait(rnd(2500, 5000));
      location.href = 'https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent(next);
    } else if (auto) {
      log(`AUTO · all queries walked, ${postQueue.length} posts queued.`);
      autoAdvance('search');
    } else {
      log(`Search pass done. ${postQueue.length} posts queued. Now run Resolve posts.`);
      mode = 'idle'; running = false; save(); render();
    }
  }

  // PASS 2: open each post and pull the author handle out of it.
  async function runIgResolvePass() {
    mode = 'igresolve'; running = true; save();
    // Only wait for post data when we are actually sitting on a post page.
    // Pressing the button from a search or profile page should move immediately.
    if (/^\/(p|reel)\//.test(location.pathname)) {
      const gotPost = await waitForPostData(12000);
      if (!gotPost) log('Post data never rendered, skipping this one.');
    } else {
      await wait(rnd(800, 1500));
    }
    harvestCurrentPage();
    if (isBlocked()) { stop('Instagram is blocking or rate limiting. Wait a few hours.'); return; }
    if (!running) return;
    const resolveCap = auto ? AUTO_RESOLVE_CAP : cfg.maxProfilesPerRun;
    if (stats.profiles >= resolveCap) {
      log(`Resolved ${stats.profiles}. Cap reached.`);
      if (auto) { autoAdvance('resolve'); return; }
      mode = 'idle'; running = false; save(); render(); return;
    }
    stats.profiles++;
    const next = postQueue.shift();
    saveNow();
    if (next) {
      log(`Resolving ${stats.profiles}/${resolveCap} · ${postQueue.length} posts left · ${Object.keys(leads).length} handles`);
      await wait(rnd(2500, 5000));
      location.href = next;
    } else if (auto) {
      log('AUTO · post queue drained.');
      autoAdvance('resolve');
    } else {
      log('Post queue is EMPTY. Run IG search pass first, or go to Enrich profiles.');
      mode = 'idle'; running = false; save(); render();
    }
  }

  /* 3.4.0 - AUTO RUN -------------------------------------------------------
     The pipeline is three stages and each one used to end by going idle and
     waiting for a button. That is why nothing could run overnight: whichever
     stage you started was the only one that ever ran. autoAdvance hands the
     baton on instead, so one press walks search -> resolve -> enrich and
     stops on its own.                                                     */
  const AUTO_POST_TARGET = 1200;   // stop searching once this many posts are queued
  const AUTO_RESOLVE_CAP = 700;    // posts to resolve into handles before enriching
  // 3.5.0 - TikTok has no resolve stage: its tag pages expose usernames
  // directly, so the run is tags -> enrich. Stop walking tags once we have
  // this many unvisited handles, more than one night can enrich anyway.
  const AUTO_TAG_TARGET  = 600;

  function unenrichedCount() {
    return Object.values(leads).filter(l => !l.enriched).length;
  }

  function autoAdvance(from) {
    if (!auto) { mode = 'idle'; running = false; save(); render(); return false; }
    if (from === 'tags') {
      auto.stage = 'enrich'; stats.profiles = 0; queue = []; visited = []; saveNow();
      log(`AUTO 2/2 · ${Object.keys(leads).length} handles known, enriching tonight's batch first.`);
      setTimeout(runProfilePass, rnd(4000, 8000));
      return true;
    }
    if (from === 'search') {
      auto.stage = 'resolve'; stats.profiles = 0; saveNow();
      log(`AUTO 2/3 · ${postQueue.length} posts queued, resolving them to handles.`);
      setTimeout(runIgResolvePass, rnd(3000, 6000));
      return true;
    }
    if (from === 'resolve') {
      auto.stage = 'enrich'; stats.profiles = 0; queue = []; visited = []; saveNow();
      log(`AUTO 3/3 · ${Object.keys(leads).length} handles known, enriching tonight's batch first.`);
      setTimeout(runProfilePass, rnd(4000, 8000));
      return true;
    }
    auto = null; mode = 'idle'; running = false; saveNow(); render();
    log(`AUTO DONE · ${Object.values(leads).filter(l => l.qualified).length} qualified in total. Press "Export all".`);
    return true;
  }

  function buildProfileQueue() {
    buildUrlIndex();                                        // 3.5.2
    const knownH = new Set(Object.keys(leads));
    const pool = Object.values(leads)
      .filter(l => !l.enriched)
      .filter(l => !(site === 'instagram' && looksWelded(l.handle, knownH)))
      .filter(l => !cfg.minRelevance || (l.relevance || 0) >= cfg.minRelevance)
      .filter(l => !visitedHas(l.profileUrl) || triesFor(l.profileUrl) < MAX_TRIES)  // 3.5.2
      .filter(l => cfg.enrichComments || leadSource(l) !== 'commenter');
    // 3.4.0 - newest batch first, THEN source, THEN relevance. Ordering by
    // relevance alone meant an aged lead with a high keyword score always beat
    // a lead discovered tonight that has no bio yet and therefore scores 0.
    pool.sort((a, b) => {
      const nb = (b.batch || 0) - (a.batch || 0);
      if (nb) return nb;
      const d = SOURCE_RANK[leadSource(a)] - SOURCE_RANK[leadSource(b)];
      if (d) return d;
      return (b.relevance || 0) - (a.relevance || 0);
    });
    queue = pool.map(l => l.profileUrl);
    const byPost = pool.filter(l => leadSource(l) === 'post').length;
    const fresh  = pool.filter(l => (l.batch || 0) === batch).length;
    const retry  = pool.filter(l => visitedHas(l.profileUrl)).length;   // 3.5.2
    log(`Queue built: ${queue.length} to visit (${byPost} from posts, ${fresh} from tonight, ${retry} retried).`);
    save();
  }

  async function runProfilePass() {
    mode = 'profiles'; running = true; save();
    buildUrlIndex();                                        // 3.5.2

    // 3.2.1: record the page we are ON before anything else, so a profile can
    // never be handed back to us as the "next" one.
    markVisited(location.href);

    const ok = await waitForProfileData(11000);

    // 3.5.1 - if this is the transient error shell rather than a real empty
    // profile, reload once and take the second look. Guarded per URL so a page
    // that is genuinely broken cannot put us in a reload loop.
    if (!ok && softErrorPage()) {
      const here = normUrl(location.href);
      if (S.get('reloadedFor', '') !== here) {
        S.set('reloadedFor', here);
        log('Soft error page, reloading once.');
        saveNow();
        await wait(rnd(2500, 4500));
        location.reload();
        return;
      }
      log('Soft error page again after reload, moving on.');
    }

    // 3.5.3 - the profile pass never checked isBlocked(); it relied on the
    // failStreak counter alone, which only fires after six profiles have
    // already burned an attempt each. Check it here, refund, and stop.
    if (!ok && isBlocked()) {
      refundTry(location.href);
      saveNow();
      stop('Rate limited. The attempt was refunded, this lead is not retired. Wait a few hours before restarting.');
      return;
    }

    if (!ok) log('Profile data never rendered, skipping.');
    harvestCurrentPage();

    // Mark whoever we just visited. 3.5.1: TikTok paths are /@handle, so the
    // leading @ has to come off or this never matched on TikTok at all and
    // dead profiles kept returning. Also give every lead two attempts before
    // writing it off, since one failure is usually the error shell above.
    // 3.5.2 - the attempt is now counted at mark time (below), because that
    // is the only point guaranteed to fire. Arriving here just means we got a
    // page: if it gave us nothing and this was the last attempt, retire it.
    const seg = (location.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '');
    if (seg && leads[seg.toLowerCase()]) {
      const L = leads[seg.toLowerCase()];
      if (!L.enriched && !ok && triesFor(location.href) >= MAX_TRIES) {
        L.enriched = true; L.dead = true;
        L.foundVia = (L.foundVia || '') + ' [no data x' + MAX_TRIES + ']';
      }
    }

    stats.profiles++;
    // Give lazy grids a moment, then scroll a little to load more tiles
    await scrollAndHarvestLight();
    if (!running) return;
    if (stats.profiles >= cfg.maxProfilesPerRun) {
      log(`Hit max ${cfg.maxProfilesPerRun} profiles. Pausing.`);
      if (auto) { autoAdvance('enrich'); return; }
      mode = 'idle'; running = false; save(); render(); return;
    }
    // Circuit breaker: if nothing is rendering, Instagram is blocking us.
    if (!ok) { failStreak++; } else { failStreak = 0; }
    if (failStreak >= 6) {
      stop('6 profiles in a row returned nothing. Instagram is likely throttling. Wait a few hours.');
      failStreak = 0; return;
    }

    // 3.2.1: the rebuild happens HERE, after the current profile has been
    // marked enriched. Rebuilding first (as 3.2.0 did) put the profile we
    // were standing on straight back into the queue, which is exactly what
    // made the pass refresh one profile forever with "0 left" on screen.
    if (!queue.length) buildProfileQueue();

    let next = queue.shift();
    let skipped = 0;
    while (next && visitedHas(next) && exhausted(next)) { next = queue.shift(); skipped++; }  // 3.5.2
    if (skipped) log(`Skipped ${skipped} profile(s) already done or out of attempts.`);
    save();

    if (next) {
      if (storageFailed) log('WARNING: browser storage is full. Press "Prune junk leads".');
      log(`Next profile · ${queue.length} left · ${Object.values(leads).filter(l => l.qualified).length} qualified`);
      markVisited(next);          // record BEFORE navigating, not after arriving
      bumpTries(next);            // 3.5.2 - and count the attempt here, where it always fires
      saveNow();
      await wait(rnd(cfg.profileDelayMin, cfg.profileDelayMax));
      location.href = next;
    } else {
      log(`Profile pass complete · ${Object.values(leads).filter(l => l.qualified).length} qualified · ${visited.length} profiles visited this run.`);
      if (auto) { autoAdvance('enrich'); return; }
      mode = 'idle'; running = false; save(); render();
    }
  }

  async function scrollAndHarvestLight() {
    // TikTok renders ~34 videos immediately so one nudge is enough. Instagram
    // renders nothing until you scroll, and needs several passes.
    const steps = site === 'instagram' ? 4 : 1;
    for (let i = 0; i < steps && running; i++) {
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      await wait(rnd(1000, 1800));
      harvestCurrentPage();
    }
  }

  function stop(reason) {
    running = false; mode = 'idle';
    if (auto) { auto = null; log('Auto run cancelled.'); }
    save(); render();
    // The Stop button wires this straight to onclick, which hands us a
    // PointerEvent. Only treat an actual string as a reason.
    log(typeof reason === 'string' && reason ? 'Stopped: ' + reason : 'Stopped.');
  }

  /* ============================================================
     EXPORT
     ============================================================ */
  function toCSV(onlyQualified) {
    const rows = Object.values(leads).filter(l => !onlyQualified || l.qualified);
    rows.sort((a, b) => (b.medianViews || 0) - (a.medianViews || 0));
    const head = ['handle', 'platform', 'name', 'followers', 'median_views', 'post_views_sampled',
                  'relevance', 'qualified', 'email', 'link', 'bio', 'captions', 'profile_url', 'found_via',
                  'batch', 'found_by_query', 'enriched', 'tries', 'was_visited'];   // 3.5.2
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\n/g, ' ') + '"';
    const lines = [head.join(',')];
    rows.forEach(r => lines.push([
      r.handle, r.platform, r.name, r.followers, r.medianViews,
      (r.postViews || []).join(' | '), r.relevance, r.qualified ? 'YES' : 'no',
      r.email, r.link, r.bio, r.captions, r.profileUrl, r.foundVia, r.batch, r.query,
      r.enriched ? 'YES' : 'no', triesFor(r.profileUrl), visitedHas(r.profileUrl) ? 'YES' : 'no'
    ].map(esc).join(',')));
    return lines.join('\n');
  }

  function download(onlyQualified) {
    const blob = new Blob([toCSV(onlyQualified)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `persona-creators-${site}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ============================================================
     UI
     ============================================================ */
  let panel, logEl;

  const logLines = [];
  function log(msg) {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    logLines.push(t + '  ' + msg);
    while (logLines.length > 10) logLines.shift();
    if (logEl) {
      logEl.textContent = logLines.join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log('[PCF]', msg);
  }

  function render() {
    if (!panel) return;
    const all = Object.values(leads);
    const q = all.filter(l => l.qualified).length;
    const en = all.filter(l => l.enriched).length;
    panel.querySelector('#pcf-stats').innerHTML =
      `<b>${all.length}</b> handles &middot; <b>${en}</b> enriched &middot; ` +
      `<b style="color:#16a34a">${q}</b> qualified &middot; ${queue.length} queued` +
      (postQueue.length ? ` &middot; ${postQueue.length} posts` : '');
    panel.querySelector('#pcf-mode').textContent =
      auto ? ('AUTO ' + String(auto.stage).toUpperCase()) : (running ? mode.toUpperCase() : 'IDLE');
    panel.querySelector('#pcf-mode').style.color = running ? '#16a34a' : '#a8a29e';
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'pcf-panel';
    panel.setAttribute('style', [
      'position:fixed !important','top:80px !important','right:16px !important',
      'z-index:2147483647 !important','width:290px !important','display:block !important',
      'visibility:visible !important','opacity:1 !important','background:#fff !important',
      'color:#1c1917 !important','border:1px solid #d6d3d1 !important',
      'border-radius:10px !important','box-shadow:0 8px 28px rgba(0,0,0,.25) !important',
      'font:12px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif !important',
      'overflow:hidden !important','pointer-events:auto !important'
    ].join(';'));
    panel.innerHTML = `
      <style>
        #pcf-panel{position:fixed;top:80px;right:16px;z-index:2147483647;width:290px;
          background:#fff;color:#1c1917;border:1px solid #d6d3d1;border-radius:10px;
          font:12px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
          box-shadow:0 8px 28px rgba(0,0,0,.18);overflow:hidden}
        #pcf-panel *{box-sizing:border-box}
        #pcf-head{background:#1c1917;color:#fff;padding:9px 11px;font-weight:600;
          display:flex;justify-content:space-between;align-items:center;cursor:move;font-size:12px}
        #pcf-body{padding:11px}
        #pcf-panel button{width:100%;padding:7px;margin:3px 0;border:1px solid #d6d3d1;
          background:#fafaf9;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500}
        #pcf-panel button:hover{background:#f5f5f4}
        #pcf-panel button.go{background:#1c1917;color:#fff;border-color:#1c1917}
        #pcf-panel button.stop{background:#dc2626;color:#fff;border-color:#dc2626}
        #pcf-panel label{display:block;margin:7px 0 2px;color:#57534e;font-size:11px}
        #pcf-panel input{width:100%;padding:5px 7px;border:1px solid #d6d3d1;border-radius:5px;font-size:12px}
        #pcf-stats{padding:7px;background:#f5f5f4;border-radius:6px;margin-bottom:8px;font-size:11px;text-align:center}
        #pcf-log{margin-top:8px;padding-top:8px;border-top:1px solid #e7e5e4;
          white-space:pre-wrap;max-height:150px;overflow-y:auto;font-family:ui-monospace,Menlo,monospace;font-size:10px;line-height:1.5;
          color:#78716c;font-size:10px;min-height:26px;word-break:break-word}
        .pcf-row{display:flex;gap:5px}
        .pcf-row button{margin:3px 0}
      </style>
      <div id="pcf-head">
        <span>Persona Creator Finder</span>
        <span id="pcf-mode" style="font-size:10px">IDLE</span>
      </div>
      <div id="pcf-body">
        <div id="pcf-stats">0 handles</div>

        <button class="go" id="pcf-auto" style="background:#15803d;border-color:#15803d">▶▶ AUTO RUN (overnight)</button>
        <button class="go" id="pcf-tags">▶ Run hashtag pass (TikTok)</button>
        <button class="go" id="pcf-igsearch">▶ 1. IG search pass</button>
        <button class="go" id="pcf-igresolve">▶ 2. Resolve posts → handles</button>
        <button class="go" id="pcf-profiles">▶ Enrich profiles</button>
        <button class="stop" id="pcf-stop">■ Stop</button>
        <button id="pcf-once">Harvest this page once</button>
        <button id="pcf-seedig">Seed IG from TikTok handles</button>

        <label>Min average views</label>
        <input id="pcf-minv" type="number" value="${cfg.minAvgViews}">
        <div class="pcf-row">
          <div style="flex:1"><label>Min followers</label>
            <input id="pcf-minf" type="number" value="${cfg.minFollowers}"></div>
          <div style="flex:1"><label>Max followers</label>
            <input id="pcf-maxf" type="number" value="${cfg.maxFollowers}"></div>
        </div>
        <label>Scrolls per hashtag</label>
        <input id="pcf-scrolls" type="number" value="${cfg.scrollsPerTag}">
        <label>Max profiles per run</label>
        <input id="pcf-maxp" type="number" value="${cfg.maxProfilesPerRun}">
        <label>Seconds between profiles (3.5.1)</label>
        <input id="pcf-delay" type="number" value="${Math.round((cfg.profileDelayMin || 6000) / 1000)}">
        <label>Min relevance (0 = off, try 2)</label>
        <input id="pcf-minrel" type="number" value="${cfg.minRelevance}">

        <div class="pcf-row">
          <button id="pcf-csvq" style="flex:1">Export qualified</button>
          <button id="pcf-csva" style="flex:1">Export all</button>
        </div>
        <button id="pcf-prune">Prune junk leads</button>
        <button id="pcf-dropcomments">Drop commenter leads</button>
        <button id="pcf-clearposts">Clear post queue</button>
        <button id="pcf-requeue">Rebuild enrich queue</button>
        <button id="pcf-revive">Revive leads killed by a throttle</button>
        <button id="pcf-reset">Clear all data</button>
        <div id="pcf-log">Ready. Open a hashtag page and press Run.</div>
      </div>`;
    (document.body || document.documentElement).appendChild(panel);
    logEl = panel.querySelector('#pcf-log');

    // TikTok/IG re-render aggressively. Put it back if it disappears.
    setInterval(() => {
      if (panel && !document.documentElement.contains(panel)) {
        try { (document.body || document.documentElement).appendChild(panel); } catch (e) {}
      }
    }, 2000);

    const readCfg = () => {
      cfg.minAvgViews    = +panel.querySelector('#pcf-minv').value || 0;
      cfg.minFollowers   = +panel.querySelector('#pcf-minf').value || 0;
      cfg.maxFollowers   = +panel.querySelector('#pcf-maxf').value || 0;
      cfg.scrollsPerTag  = +panel.querySelector('#pcf-scrolls').value || 20;
      cfg.maxProfilesPerRun = +panel.querySelector('#pcf-maxp').value || 40;
      // 3.5.1 - one field sets the floor; the ceiling is randomised above it so
      // the gaps never look machine-regular.
      const secs = +panel.querySelector('#pcf-delay').value || 6;
      cfg.profileDelayMin = Math.max(2, secs) * 1000;
      cfg.profileDelayMax = cfg.profileDelayMin + Math.round(cfg.profileDelayMin * 0.8);
      cfg.minRelevance = +panel.querySelector('#pcf-minrel').value || 0;
      Object.values(leads).forEach(l => { l.relevance = scoreRelevance(l); l.qualified = qualifies(l); });
      save(); render();
    };
    panel.querySelectorAll('input').forEach(i => i.addEventListener('change', readCfg));

    panel.querySelector('#pcf-auto').onclick = () => {
      readCfg();
      batch++;                       // everything found tonight carries this number
      queue = []; visited = []; stats.profiles = 0; curQuery = '';
      if (site === 'tiktok') {
        // 3.5.0 - TikTok is two stages, not three. Tag pages expose usernames
        // directly, so there is nothing to resolve.
        auto = { stage: 'tags' };
        tagQueue = [];
        saveNow();
        log(`AUTO 1/2 · batch ${batch}. Walking tags. Leave this tab open, it chains by itself.`);
        runTagPass();
      } else {
        auto = { stage: 'search' };
        qQueue = []; postQueue = [];
        saveNow();
        log(`AUTO 1/3 · batch ${batch}. Searching. Leave this tab open, it chains by itself.`);
        runIgSearchPass();
      }
    };

    panel.querySelector('#pcf-tags').onclick     = () => { readCfg(); stats.profiles = 0; runTagPass(); };
    panel.querySelector('#pcf-igsearch').onclick  = () => { readCfg(); qQueue = []; runIgSearchPass(); };
    panel.querySelector('#pcf-igresolve').onclick = () => { readCfg(); stats.profiles = 0; runIgResolvePass(); };
    panel.querySelector('#pcf-profiles').onclick = () => {
      readCfg(); stats.profiles = 0; queue = []; visited = [];   // 3.2.1: fresh run, fresh visit log
      runProfilePass();
    };
    panel.querySelector('#pcf-stop').onclick     = stop;
    panel.querySelector('#pcf-once').onclick     = () => { harvestCurrentPage(); log('Harvested this page.'); };
    panel.querySelector('#pcf-seedig').onclick   = () => {
      // Most creators reuse their handle across platforms. Rather than fight
      // Instagram's search (its grids expose /p/<id>/ with no username), we
      // reuse the TikTok handles we already have and check which exist on IG.
      const tk = Object.values(leads).filter(l => l.platform === 'tiktok');
      let added = 0;
      tk.forEach(l => {
        const h = l.handle.toLowerCase();
        if (!leads[h] || leads[h].platform !== 'instagram') {
          const igKey = 'ig:' + h;
          if (!leads[igKey]) {
            leads[igKey] = {
              handle: l.handle, platform: 'instagram', followers: null, medianViews: null,
              postViews: [], bio: '', email: '', link: '', name: '',
              captions: l.captions || '', relevance: l.relevance || 0,
              profileUrl: `https://www.instagram.com/${l.handle}/reels/`,
              enriched: false, qualified: false, foundVia: 'seeded from tiktok'
            };
            added++;
          }
        }
      });
      saveNow(); render();
      log(`Seeded ${added} Instagram profiles from TikTok handles. Press Enrich profiles on Instagram.`);
    };
    panel.querySelector('#pcf-csvq').onclick     = () => download(true);
    panel.querySelector('#pcf-csva').onclick     = () => download(false);
    panel.querySelector('#pcf-revive').onclick = () => {
      // 3.5.3 - undo the damage from a throttle that ran before this version.
      // Only touches leads marked dead with no median, so anything genuinely
      // enriched is left alone.
      const n = reviveDead();
      queue = []; buildProfileQueue(); saveNow(); render();
      log(`Revived ${n} lead(s) that were retired without ever returning data. Queue is now ${queue.length}.`);
    };

    panel.querySelector('#pcf-requeue').onclick = () => {
      // 3.5.2 - the profile queue only rebuilds when it empties, so leads that
      // were orphaned by an earlier run sit unreachable until it drains. This
      // forces the rebuild now so the retry pass picks them up immediately.
      const orphans = orphanCount();
      queue = [];
      buildProfileQueue();
      saveNow(); render();
      log(`Enrich queue rebuilt · ${queue.length} to visit · ${orphans} of them previously orphaned.`);
    };

    panel.querySelector('#pcf-clearposts').onclick = () => {
      // 3.3.1 - the post queue is FIFO and persists across runs, so stale URLs
      // collected by earlier searches are resolved before anything new. Clearing
      // it is what lets a reordered query list actually take effect.
      const had = postQueue.length;
      postQueue = [];
      saveNow(); render();
      log(`Cleared ${had} queued posts. Run the IG search pass to refill it.`);
    };

    panel.querySelector('#pcf-dropcomments').onclick = () => {
      // 3.3.0 - remove unenriched commenter leads outright. Keeps anything
      // already enriched so no measured data is lost.
      const before = Object.keys(leads).length;
      Object.keys(leads).forEach(h => {
        const L = leads[h];
        if (!L.enriched && leadSource(L) === 'commenter') delete leads[h];
      });
      const removed = before - Object.keys(leads).length;
      queue = []; saveNow(); render();
      log(`Dropped ${removed} unenriched commenter leads. ${Object.keys(leads).length} left.`);
    };

    panel.querySelector('#pcf-prune').onclick = () => {
      // Drop unenriched, zero-relevance commenter leads. These are 90%+ of the
      // dataset by volume and are what pushes browser storage over its limit.
      const before = Object.keys(leads).length;
      Object.keys(leads).forEach(h => {
        const L = leads[h];
        if (!L.enriched && (L.relevance || 0) < 1 && !L.email) delete leads[h];
      });
      // Trim the text we keep on everyone else.
      Object.values(leads).forEach(L => {
        if (L.bio) L.bio = L.bio.slice(0, 200);
        if (L.captions) L.captions = L.captions.slice(0, 200);
      });
      queue = queue.filter(u => {
        const m = String(u).match(/\/@?([^\/?]+)/g);
        return true;
      });
      const after = Object.keys(leads).length;
      storageFailed = false;
      saveNow(); render();
      log(`Pruned ${before - after} junk leads. ${after} kept.` + (storageFailed ? ' Storage STILL failing.' : ' Storage OK.'));
    };

    panel.querySelector('#pcf-reset').onclick    = () => {
      if (!confirm('Delete all collected leads?')) return;
      leads = {}; queue = []; tagQueue = []; postQueue = []; qQueue = [];
      stats = { scanned: 0, profiles: 0, qualified: 0 };
      save(); render(); log('Cleared.');
    };

    // draggable
    const head = panel.querySelector('#pcf-head');
    let dx = 0, dy = 0, drag = false;
    head.onmousedown = e => { drag = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop; };
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (e.clientX - dx) + 'px';
      panel.style.top  = (e.clientY - dy) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => drag = false);

    render();
  }

  /* ============================================================
     BOOT - resume whatever pass was running before navigation
     ============================================================ */
  let bootTries = 0;
  function boot() {
    bootTries++;
    if (!document.body) {
      if (bootTries < 60) return setTimeout(boot, 400);
      console.warn('[PCF] no document.body after 24s, attaching to documentElement anyway');
    }
    if (document.getElementById('pcf-panel')) { console.log('[PCF] panel already present'); return; }
    try {
      buildPanel();
      console.log('%c[PCF] panel built', 'color:#16a34a');
    } catch (e) {
      console.error('[PCF] PANEL BUILD FAILED:', e);
      const d = document.createElement('div');
      d.textContent = 'PCF error: ' + e.message;
      d.setAttribute('style','position:fixed;top:10px;right:10px;z-index:2147483647;background:#dc2626;color:#fff;padding:8px 12px;border-radius:6px;font:12px sans-serif');
      (document.body || document.documentElement).appendChild(d);
      return;
    }
    // One-time cleanup: remove leads created by the pre-2.3.0 slash-stripping bug
    // (e.g. "exploretagsaiagents") and drop them from the pending queue.
    if (!S.get('cleaned320', false)) {
      const known = new Set(Object.keys(leads));
      const bad = Object.keys(leads).filter(h =>
        IG_RESERVED.has(h) || /^(explore|accounts|direct|stories|challenge)/.test(h) ||
        looksWelded(h, known));
      bad.forEach(h => { delete leads[h]; });
      queue = queue.filter(u => !bad.some(h => u.indexOf('/' + h + '/') !== -1));
      S.set('cleaned320', true);
      saveNow();
      if (bad.length) log(`Cleanup: removed ${bad.length} junk leads from the URL bug.`);
    }

    // 3.3.0 - rescore every stored lead once, so leads scored under the old
    // substring rule are re-judged by the word-boundary rule.
    if (!S.get('rescored333', false)) {
      let changed = 0;
      Object.values(leads).forEach(l => {
        const before = l.relevance || 0;
        l.relevance = scoreRelevance(l);
        l.qualified = qualifies(l);
        if (l.relevance !== before) changed++;
      });
      S.set('rescored333', true);
      saveNow();
      if (changed) log(`Rescored ${changed} leads under the stricter keyword rule.`);
    }

    harvestCurrentPage();

    if (mode === 'tags') { running = true; setTimeout(runTagPass, rnd(2000, 4000)); }
    else if (mode === 'profiles') { running = true; setTimeout(runProfilePass, rnd(2000, 4000)); }
    else if (mode === 'igsearch') { running = true; setTimeout(runIgSearchPass, rnd(2000, 4000)); }
    else if (mode === 'igresolve') { running = true; setTimeout(runIgResolvePass, rnd(2000, 4000)); }

    // Only watch mutations when idle. During an automated pass the loop already
    // harvests on a schedule, and doubling up was the main performance problem.
    const mo = new MutationObserver(() => {
      if (running) return;
      clearTimeout(window.__pcfT);
      window.__pcfT = setTimeout(harvestCurrentPage, 1200);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  }

  boot();
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('load', boot);
  setTimeout(boot, 1500);
  setTimeout(boot, 4000);
})();
