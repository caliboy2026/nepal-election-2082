// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — V3.1 Server-Side Accumulated Scraper
//
// UPDATED: NepseBarjar removed directWinData from main page.
// Now uses static MASTER_LIST (165 constituencies) + deep scrape.
//
// Every call:
//   1. Quick scrape main page for parliamentChartData (party seats)
//   2. Deep scrape ONE batch of constituency detail pages
//   3. Merge into accumulated cache
//   4. Return all available data
//
// After ~11 calls, full 165-constituency dataset is built.
// All users share the same server-side cache.
// ═══════════════════════════════════════════════════════════

const NEPSEBAJAR_URL = 'https://election.nepsebajar.com/en';
const ONLINEKHABAR_API = 'https://election.onlinekhabar.com/wp-json/okelapi/v1/2082/home/election-results?limit=200';
const BATCH_SIZE = 15;

// ═══ IN-MEMORY STATE (may be wiped on isolate recycle) ═══
let deepCache = {};          // constituency id → constituency data
let deepCacheTimestamp = 0;
let currentBatch = 0;
let quickCache = null;
let quickCacheTimestamp = 0;
let quickSourceToggle = 0;   // alternates between 0=NepseBajar, 1=OnlineKhabar
let kvLoaded = false;        // whether we've loaded from KV this isolate

// ═══ KV PERSISTENCE — survives isolate restarts ═══
const KV_KEY = 'deepCache_v1';
const KV_PARTY_HWM_KEY = 'partyHighWaterMark_v1';  // persists party won/total across isolate recycles

// Party-level high-water marks that survive isolate restarts
let partyHWM = {};  // { partyKey: { won: N, total: N } }

async function loadFromKV(env) {
  if (kvLoaded || !env.ELECTION_CACHE) return;
  try {
    const stored = await env.ELECTION_CACHE.get(KV_KEY, 'json');
    if (stored && stored.data && Object.keys(stored.data).length > 0) {
      // Only load if in-memory cache is empty or KV has more data
      if (Object.keys(deepCache).length < Object.keys(stored.data).length) {
        deepCache = stored.data;
        deepCacheTimestamp = stored.timestamp || Date.now();
        currentBatch = stored.currentBatch || 0;
        console.log(`[KV] Loaded ${Object.keys(deepCache).length} constituencies from KV`);
      }
    }
    // Load party high-water marks
    const hwmStored = await env.ELECTION_CACHE.get(KV_PARTY_HWM_KEY, 'json');
    if (hwmStored && Object.keys(hwmStored).length > 0) {
      partyHWM = hwmStored;
      console.log(`[KV] Loaded party HWM for ${Object.keys(partyHWM).length} parties`);
    }
  } catch (e) {
    console.log(`[KV] Load error: ${e.message}`);
  }
  kvLoaded = true;
}

async function saveToKV(env) {
  if (!env.ELECTION_CACHE) return;
  try {
    await env.ELECTION_CACHE.put(KV_KEY, JSON.stringify({
      data: deepCache,
      timestamp: deepCacheTimestamp,
      currentBatch,
      savedAt: new Date().toISOString()
    }));
    // Also persist party high-water marks
    if (Object.keys(partyHWM).length > 0) {
      await env.ELECTION_CACHE.put(KV_PARTY_HWM_KEY, JSON.stringify(partyHWM));
    }
  } catch (e) {
    console.log(`[KV] Save error: ${e.message}`);
  }
}

const TOTAL_CONSTITUENCIES = 165;
const TOTAL_BATCHES = Math.ceil(TOTAL_CONSTITUENCIES / BATCH_SIZE); // 11

// ═══ STATIC MASTER LIST ═══
// Maps pdniCenterId → [name, province]
// Source: NepseBarjar centers.xml sitemap (165 constituencies)
const MASTER_LIST = {
  1:["Kathmandu-1","Bagmati"],2:["Kathmandu-7","Bagmati"],3:["Kathmandu-2","Bagmati"],
  4:["Parsa-1","Madhesh"],5:["Kathmandu-9","Bagmati"],6:["Bhaktapur-1","Bagmati"],
  7:["Sunsari-4","Koshi"],8:["Sunsari-1","Koshi"],9:["Kavrepalanchok-2","Bagmati"],
  10:["Dhanusha-4","Madhesh"],11:["Jhapa-2","Koshi"],12:["Baitadi-1","Sudurpashchim"],
  13:["Dang-2","Lumbini"],14:["Kathmandu-10","Bagmati"],15:["Rupandehi-2","Lumbini"],
  16:["Saptari-2","Madhesh"],17:["Kathmandu-4","Bagmati"],18:["Achham-2","Sudurpashchim"],
  19:["Jhapa-1","Koshi"],20:["Dadeldhura-1","Sudurpashchim"],21:["Saptari-1","Madhesh"],
  22:["Bhojpur-1","Koshi"],23:["Bara-3","Madhesh"],24:["Rupandehi-3","Lumbini"],
  25:["Morang-2","Koshi"],26:["Morang-6","Koshi"],27:["Morang-1","Koshi"],
  28:["Siraha-1","Madhesh"],29:["Tanahun-1","Gandaki"],30:["Lalitpur-3","Bagmati"],
  31:["Sunsari-3","Koshi"],32:["Dhanusha-3","Madhesh"],33:["Kapilvastu-3","Lumbini"],
  34:["Saptari-3","Madhesh"],35:["Chitwan-3","Bagmati"],36:["Kailali-3","Sudurpashchim"],
  37:["Kailali-5","Sudurpashchim"],38:["Kavrepalanchok-1","Bagmati"],39:["Udayapur-2","Koshi"],
  40:["Chitwan-1","Bagmati"],41:["Kathmandu-8","Bagmati"],42:["Sarlahi-1","Madhesh"],
  43:["Lalitpur-2","Bagmati"],44:["Makwanpur-1","Bagmati"],45:["Dolakha-1","Bagmati"],
  46:["Manang-1","Gandaki"],47:["Jhapa-3","Koshi"],48:["Arghakhanchi-1","Lumbini"],
  49:["Mahottari-4","Madhesh"],50:["Bhaktapur-2","Bagmati"],51:["Sindhupalchok-2","Bagmati"],
  52:["Kathmandu-5","Bagmati"],53:["Bara-2","Madhesh"],54:["Chitwan-2","Bagmati"],
  55:["Jhapa-5","Koshi"],56:["Nawalparasi West-2","Lumbini"],57:["Rupandehi-1","Lumbini"],
  58:["Ilam-1","Koshi"],59:["Parsa-3","Madhesh"],60:["Morang-3","Koshi"],
  61:["Palpa-2","Lumbini"],62:["Mahottari-2","Madhesh"],63:["Pyuthan-1","Lumbini"],
  64:["Dhading-1","Bagmati"],65:["Mahottari-3","Madhesh"],66:["Rupandehi-5","Lumbini"],
  67:["Palpa-1","Lumbini"],68:["Bara-4","Madhesh"],69:["Panchthar-1","Koshi"],
  70:["Kapilvastu-2","Lumbini"],71:["Lalitpur-1","Bagmati"],72:["Terhathum-1","Koshi"],
  73:["Dang-3","Lumbini"],74:["Bardiya-2","Lumbini"],75:["Kaski-2","Gandaki"],
  76:["Rupandehi-4","Lumbini"],77:["Kathmandu-3","Bagmati"],78:["Parsa-2","Madhesh"],
  79:["Dailekh-1","Karnali"],80:["Sunsari-2","Koshi"],81:["Dang-1","Lumbini"],
  82:["Kaski-3","Gandaki"],83:["Kailali-4","Sudurpashchim"],84:["Jhapa-4","Koshi"],
  85:["Solukhumbu-1","Koshi"],86:["Bardiya-1","Lumbini"],87:["Rasuwa-1","Bagmati"],
  88:["Morang-4","Koshi"],89:["Nawalparasi East-1","Gandaki"],90:["Gulmi-1","Lumbini"],
  91:["Sindhupalchok-1","Bagmati"],92:["Dhanusha-1","Madhesh"],93:["Dhading-2","Bagmati"],
  94:["Darchula-1","Sudurpashchim"],95:["Makwanpur-2","Bagmati"],96:["Gorkha-1","Gandaki"],
  97:["Syangja-1","Gandaki"],98:["Mahottari-1","Madhesh"],99:["Rautahat-1","Madhesh"],
  100:["Kathmandu-6","Bagmati"],101:["Kanchanpur-2","Sudurpashchim"],102:["Ilam-2","Koshi"],
  103:["Bara-1","Madhesh"],104:["Kapilvastu-1","Lumbini"],105:["Rautahat-2","Madhesh"],
  106:["Parsa-4","Madhesh"],107:["Morang-5","Koshi"],108:["Sindhuli-2","Bagmati"],
  109:["Ramechhap-1","Bagmati"],110:["Khotang-1","Koshi"],111:["Rautahat-3","Madhesh"],
  112:["Gorkha-2","Gandaki"],113:["Parbat-1","Gandaki"],114:["Gulmi-2","Lumbini"],
  115:["Sarlahi-2","Madhesh"],116:["Kaski-1","Gandaki"],117:["Kanchanpur-3","Sudurpashchim"],
  118:["Banke-1","Lumbini"],119:["Myagdi-1","Gandaki"],120:["Banke-3","Lumbini"],
  121:["Banke-2","Lumbini"],122:["Nawalparasi East-2","Gandaki"],123:["Siraha-2","Madhesh"],
  124:["Sindhuli-1","Bagmati"],125:["Rautahat-4","Madhesh"],126:["Doti-1","Sudurpashchim"],
  127:["Taplejung-1","Koshi"],128:["Nuwakot-2","Bagmati"],129:["Tanahun-2","Gandaki"],
  130:["Achham-1","Sudurpashchim"],131:["Nawalparasi West-1","Lumbini"],132:["Salyan-1","Karnali"],
  133:["Udayapur-1","Koshi"],134:["Surkhet-2","Karnali"],135:["Siraha-4","Madhesh"],
  136:["Dhankuta-1","Koshi"],137:["Okhaldhunga-1","Koshi"],138:["Baglung-1","Gandaki"],
  139:["Sankhuwasabha-1","Koshi"],140:["Dhanusha-2","Madhesh"],141:["Kailali-2","Sudurpashchim"],
  142:["Sarlahi-4","Madhesh"],143:["Lamjung-1","Gandaki"],144:["Siraha-3","Madhesh"],
  145:["Sarlahi-3","Madhesh"],146:["Nuwakot-1","Bagmati"],147:["Saptari-4","Madhesh"],
  148:["Dailekh-2","Karnali"],149:["Rukum West-1","Karnali"],150:["Bajhang-1","Sudurpashchim"],
  151:["Jajarkot-1","Karnali"],152:["Syangja-2","Gandaki"],153:["Rolpa-1","Lumbini"],
  154:["Surkhet-1","Karnali"],155:["Kanchanpur-1","Sudurpashchim"],156:["Kalikot-1","Karnali"],
  157:["Rukum East-1","Lumbini"],158:["Baglung-2","Gandaki"],159:["Bajura-1","Sudurpashchim"],
  160:["Mustang-1","Gandaki"],161:["Kailali-1","Sudurpashchim"],162:["Dolpa-1","Karnali"],
  163:["Mugu-1","Karnali"],164:["Humla-1","Karnali"],165:["Jumla-1","Karnali"]
};

// ── Party mappings ──
const PARTY_ID_MAP = {
  41: 'RSP', 2: 'NC', 1: 'UML', 275: 'NCP', 4: 'JSP',
  5: 'RPP', 273: 'SSP', 274: 'UNP', 200: 'IND', 277: 'PLP',
};

const PARTY_NAME_MAP = {
  'rastriya swatantra party': 'RSP', 'swatantra': 'RSP',
  'nepali congress': 'NC', 'congress': 'NC',
  'nepal communist party (uml)': 'UML', 'cpn (uml)': 'UML', 'uml': 'UML',
  'nepali communist party': 'NCP', 'maoist': 'NCP',
  'rastriya prajatantra party': 'RPP', 'prajatantra': 'RPP',
  'janata samajwadi party': 'JSP', 'samajwadi': 'JSP',
  'janamat party': 'JMP',
  'shram sanskriti party': 'SSP', 'shram sanskriti': 'SSP',
  'ujyalo nepal party': 'UNP', 'ujyalo': 'UNP',
  'nepal janmukti party': 'NJP',
  'mongol national organization': 'MNO',
  'federal democratic national forum': 'FDNF',
  'rastriya mukti party': 'RMP',
  'independent': 'IND',
  'people first party': 'PFP',
  'rastriya parivartan party': 'RPVP',
  'nepal communist party (maoist)': 'NCP',
  'pragatishil loktantrik party': 'PLP', 'progressive democratic': 'PLP',
};

function normalizePartyById(partyId, partyName) {
  if (partyId && PARTY_ID_MAP[partyId]) return PARTY_ID_MAP[partyId];
  return normalizePartyByName(partyName);
}

function normalizePartyByName(partyName) {
  if (!partyName) return 'OTH';
  const lower = partyName.toLowerCase().trim();
  for (const [key, val] of Object.entries(PARTY_NAME_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  if (lower.includes('independent') || lower.includes('स्वतन्त्र')) return 'IND';
  return 'OTH';
}

// OnlineKhabar party_slug → our party key
const OK_SLUG_MAP = {
  'rastriya-swatantra-party-rsp': 'RSP',
  'nepali-congress': 'NC',
  'cpn-uml': 'UML',
  'nepali-communist-party': 'NCP',
  'rastriya-prajatantra-party': 'RPP',
  'janata-samajwadi-party-nepal': 'JSP',
  'janamat-party': 'JMP',
  'shram-sanskriti-party': 'SSP',
  'ujyalo-nepal-party': 'UNP',
  'independent': 'IND',
  'pargatishilloktantrikparty': 'PLP',
  'nepal-workers-peasants-party-majdur-kishan-party': 'NJP',
};

async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Nepal-Election-Dashboard/3.1)',
        'Accept': 'text/html, */*'
      },
      redirect: 'follow'
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ═══ QUICK SCRAPE (NepseBajar): Main page → party seat totals ═══
async function quickScrapeNepseBajar() {
  const res = await fetchWithTimeout(NEPSEBAJAR_URL, 8000);
  const html = await res.text();

  const result = { partySeats: {}, source: 'nepsebajar' };

  // Parse parliamentChartData → party seat totals (still works)
  const pcMatch = html.match(/parliamentChartData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (pcMatch) {
    try {
      const pcData = JSON.parse(pcMatch[1]);
      for (const entry of pcData) {
        if (entry.PartyID === 0) continue;
        const key = normalizePartyById(entry.PartyID, entry.name);
        result.partySeats[key] = {
          total: entry.y || 0,
          direct: (entry.y || 0) - (entry.propPortion || 0),
          pr: entry.propPortion || 0,
          leading: 0,
          won: 0
        };
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Parse HTML table for Leading vs Win breakdown
  const tableMatch = html.match(/Leading<\/th>([\s\S]*?)<\/table>/);
  if (tableMatch) {
    const tableHtml = tableMatch[1];
    const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const partyNameMatch = row.match(/text-\[15px\][^>]*>\s*([^<]+)/);
      if (!partyNameMatch) continue;
      const partyName = partyNameMatch[1].trim();
      const key = normalizePartyByName(partyName);
      if (key === 'OTH') continue;
      const tds = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
      const cellToNum = (td) => {
        const clean = td.replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
        const m = clean.match(/^(\d+)/);
        return m ? parseInt(m[1]) : 0;
      };
      if (tds.length >= 3 && result.partySeats[key]) {
        result.partySeats[key].leading = cellToNum(tds[1]);
        result.partySeats[key].won = cellToNum(tds[2]);
      }
    }
  }

  return result;
}

// ═══ QUICK SCRAPE (OnlineKhabar): JSON API → party seat totals ═══
async function quickScrapeOnlineKhabar() {
  const res = await fetchWithTimeout(ONLINEKHABAR_API, 6000);
  const json = await res.json();

  const result = { partySeats: {}, source: 'onlinekhabar' };

  if (json.status === 200 && json.data && json.data.party_results) {
    for (const p of json.data.party_results) {
      const key = OK_SLUG_MAP[p.party_slug] || normalizePartyByName(p.party_name || '');
      if (key === 'OTH') continue;
      result.partySeats[key] = {
        total: p.total_seat || 0,
        direct: (p.total_seat || 0),
        pr: 0,
        leading: p.leading_count || 0,
        won: p.winner_count || 0
      };
    }
  }

  return result;
}

// ═══ QUICK SCRAPE: Alternate between NepseBajar and OnlineKhabar ═══
// Merges results using high-water mark: won and total can only increase.
// Uses BOTH in-memory quickCache AND persistent partyHWM (survives isolate restarts).
function mergeWithHighWaterMark(newResult) {
  for (const [key, newData] of Object.entries(newResult.partySeats)) {
    const prev = quickCache?.partySeats?.[key];
    const hwm = partyHWM[key] || { won: 0, total: 0 };

    // Get the best-known won from all sources: new scrape, in-memory cache, persistent HWM
    const bestWon = Math.max(newData.won || 0, prev?.won || 0, hwm.won || 0);
    const newTotal = (newData.won || 0) + (newData.leading || 0);
    const prevTotal = prev ? ((prev.won || 0) + (prev.leading || 0)) : 0;
    const bestTotal = Math.max(newTotal, prevTotal, hwm.total || 0);

    // Won only goes up
    newData.won = bestWon;
    // Leading = bestTotal - bestWon (so total never drops)
    newData.leading = Math.max(0, bestTotal - bestWon);

    // Update persistent HWM
    partyHWM[key] = { won: bestWon, total: bestTotal };
  }

  // Carry forward any parties from quickCache that the new source didn't return
  if (quickCache?.partySeats) {
    for (const [key, prevData] of Object.entries(quickCache.partySeats)) {
      if (!newResult.partySeats[key]) {
        newResult.partySeats[key] = prevData;
      }
    }
  }
  // Also carry forward from HWM (covers isolate restart case)
  for (const [key, hwm] of Object.entries(partyHWM)) {
    if (!newResult.partySeats[key] && hwm.won > 0) {
      newResult.partySeats[key] = { won: hwm.won, leading: Math.max(0, (hwm.total || 0) - hwm.won) };
    }
  }

  return newResult;
}

async function quickScrape() {
  const now = Date.now();
  if (quickCache && (now - quickCacheTimestamp) < 25000) {
    return quickCache;
  }

  const useSource = quickSourceToggle % 2; // 0=NepseBajar, 1=OnlineKhabar
  quickSourceToggle++;

  let result;
  try {
    if (useSource === 0) {
      result = await quickScrapeNepseBajar();
    } else {
      result = await quickScrapeOnlineKhabar();
    }
    // Validate: must have at least some party data
    if (!result.partySeats || Object.keys(result.partySeats).length === 0) {
      throw new Error('Empty party data from ' + (useSource === 0 ? 'NepseBajar' : 'OnlineKhabar'));
    }
  } catch (e) {
    // Fallback: try the other source
    console.log(`[QuickScrape] ${useSource === 0 ? 'NepseBajar' : 'OnlineKhabar'} failed: ${e.message}, trying fallback`);
    try {
      if (useSource === 0) {
        result = await quickScrapeOnlineKhabar();
      } else {
        result = await quickScrapeNepseBajar();
      }
    } catch (e2) {
      // Both failed — return stale cache if available
      if (quickCache) return quickCache;
      throw e2;
    }
  }

  // Merge with high-water mark so won never decreases across sources
  result = mergeWithHighWaterMark(result);

  quickCache = result;
  quickCacheTimestamp = now;
  return result;
}

// ═══ DEEP SCRAPE: Parse a single constituency page ═══
function parseConstituencyPage(html, id) {
  const master = MASTER_LIST[id];
  if (!master) return null;
  const [name, province] = master;

  const candidates = [];

  // Split HTML into per-candidate blocks for reliable parsing
  const blocks = html.split(/(?=candidate\/\d+\/[^/]+\/elec2082)/g);
  for (const block of blocks) {
    const linkMatch = block.match(/^candidate\/(\d+)\/([^/]+)\/elec2082/);
    if (!linkMatch) continue;

    const nameMatch = block.match(/<h4[^>]*>\s*([^<]+)\s*<\/h4>/);
    if (!nameMatch) continue;

    // Party: try <span>Party</span> first (leader card), then text-[10px] div content
    let partyFull = '';
    const spanParty = block.match(/text-\[10px\][\s\S]*?<span>([^<]+)<\/span>/);
    if (spanParty) {
      partyFull = spanParty[1].trim();
    } else {
      const divParty = block.match(/text-\[10px\][^>]*>\s*([^<]+)\s*<\/div>/);
      if (divParty) partyFull = divParty[1].trim();
    }

    // Votes: find font-bold followed by number
    const votesMatch = block.match(/font-bold[^>]*>\s*([0-9,]+)/);
    if (!votesMatch) continue;

    candidates.push({
      name: nameMatch[1].trim(),
      party: normalizePartyByName(partyFull),
      partyFull,
      votes: parseInt(votesMatch[1].replace(/,/g, '')) || 0,
      candidateId: linkMatch[1],
      slug: linkMatch[2],
      photo: ''
    });
  }

  // Extract photo URLs — photo appears BEFORE candidate link in HTML
  const photoMap = {};
  const photoRegex = /img\/candidates\/([^"\s]+\.jpg)[\s\S]*?candidate\/(\d+)\//g;
  let pm;
  while ((pm = photoRegex.exec(html)) !== null) {
    if (!photoMap[pm[2]]) {
      photoMap[pm[2]] = `https://election.nepsebajar.com/img/candidates/${pm[1]}`;
    }
  }
  for (const c of candidates) {
    if (photoMap[c.candidateId]) c.photo = photoMap[c.candidateId];
  }

  // NepseBarjar shows "Elected" on all pages regardless of official declaration
  // Actual won/counting status is determined client-side using party won counts
  let apiStatus = '';
  let counted = '';

  candidates.sort((a, b) => b.votes - a.votes);

  return {
    name,
    normalizedName: name.toLowerCase().replace(/\s+/g, ''),
    province,
    pdniCenterId: id,
    apiStatus,
    counted,
    totalCandidates: candidates.length,
    candidates
  };
}

// ═══ DEEP SCRAPE: One batch of constituency pages ═══
async function deepScrapeOneBatch() {
  const allIds = Object.keys(MASTER_LIST).map(Number);
  const startIdx = currentBatch * BATCH_SIZE;
  const batchIds = allIds.slice(startIdx, startIdx + BATCH_SIZE);

  if (batchIds.length === 0) {
    currentBatch = 0;
    return { fetched: 0, failed: 0 };
  }

  let fetched = 0, failed = 0;

  const results = await Promise.allSettled(
    batchIds.map(async (id) => {
      try {
        const url = `https://election.nepsebajar.com/en/pratinidhi/${id}`;
        const res = await fetchWithTimeout(url);
        const html = await res.text();
        return { ok: true, data: parseConstituencyPage(html, id) };
      } catch (err) {
        return { ok: false, id };
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok && r.value.data) {
      const constData = r.value.data;
      if (constData.candidates.length > 0) {
        const existing = deepCache[constData.pdniCenterId];
        if (!existing ||
            constData.candidates.length > existing.candidates.length ||
            (constData.candidates[0]?.votes || 0) >= (existing.candidates[0]?.votes || 0)) {
          deepCache[constData.pdniCenterId] = constData;
          deepCacheTimestamp = Date.now();
        }
      }
      fetched++;
    } else {
      failed++;
    }
  }

  currentBatch = (currentBatch + 1) % TOTAL_BATCHES;
  return { fetched, failed };
}

// ═══ BUILD RESPONSE: Merge party seats + deep cache ═══
function buildResponse(quick, deepResult, startTime) {
  const constituencies = [];
  const deepCacheSize = Object.keys(deepCache).length;

  // Count party wins from deep-scraped constituency data (leader = winner for finalized results)
  const partyWins = {};

  // Emit all constituencies — deep cache first, then skeleton for uncached
  for (const [idStr, [name, province]] of Object.entries(MASTER_LIST)) {
    const id = parseInt(idStr);
    const deepData = deepCache[id];
    if (deepData && deepData.candidates.length > 0) {
      constituencies.push(deepData);
      // Count the leading candidate's party as a win
      const topCand = deepData.candidates[0];
      if (topCand && topCand.votes > 0) {
        partyWins[topCand.party] = (partyWins[topCand.party] || 0) + 1;
      }
    } else {
      constituencies.push({
        name,
        normalizedName: name.toLowerCase().replace(/\s+/g, ''),
        province,
        pdniCenterId: id,
        counted: '',
        candidates: []
      });
    }
  }

  // Build parties object — use HTML table Leading/Win breakdown (authoritative)
  // parliamentChartData only gives combined direct (leading+won), not separate
  const parties = {};
  if (quick.partySeats) {
    for (const [key, data] of Object.entries(quick.partySeats)) {
      parties[key] = {
        won: data.won || 0,           // Officially declared wins from table
        leading: data.leading || 0     // Currently leading from table
      };
    }
  }
  // Supplement from deep cache for any parties not in parliamentChartData
  for (const [key, count] of Object.entries(partyWins)) {
    if (!parties[key]) parties[key] = { won: 0, leading: count };
  }

  return {
    timestamp: new Date().toISOString(),
    fetchDurationMs: Date.now() - startTime,
    sources: {
      successful: [{
        name: `${quick.source || 'nepsebajar'}-v3.2`,
        constituencies: constituencies.length,
        deepCached: deepCacheSize,
        partySeats: quick.partySeats
      }],
      failed: []
    },
    data: {
      parties,
      constituencies,
      partySeats: quick.partySeats,
      meta: {
        totalSeats: 275,
        fptpSeats: 165,
        prSeats: 110,
        majorityMark: 138
      }
    },
    v3status: {
      deepCached: deepCacheSize,
      totalConstituencies: TOTAL_CONSTITUENCIES,
      currentBatch,
      totalBatches: TOTAL_BATCHES,
      deepCacheAge: deepCacheTimestamp ? Math.round((Date.now() - deepCacheTimestamp) / 1000) : null,
      deepBatchResult: deepResult
    }
  };
}

// ═══ CLOUDFLARE WORKER HANDLER ═══
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=30'
    }
  });
}

export default {
  async fetch(request, env) {
    // Load deep cache from KV on cold start
    await loadFromKV(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const startTime = Date.now();

    // ?status=true → return cache status for debugging
    if (params.status) {
      return jsonResponse({
        version: 'v3.3-cf-dual-source-hwm-persist',
        deepCached: Object.keys(deepCache).length,
        kvAvailable: !!env.ELECTION_CACHE,
        totalConstituencies: TOTAL_CONSTITUENCIES,
        totalBatches: TOTAL_BATCHES,
        currentBatch,
        quickSource: quickCache ? quickCache.source : null,
        quickSourceToggle,
        deepCacheAge: deepCacheTimestamp ? Math.round((Date.now() - deepCacheTimestamp) / 1000) : null,
        quickCacheAge: quickCacheTimestamp ? Math.round((Date.now() - quickCacheTimestamp) / 1000) : null,
      });
    }

    try {
      // Step 1: Quick scrape — party seat totals from main page
      let quick;
      try {
        quick = await quickScrape();
      } catch (e) {
        quick = quickCache || { partySeats: {} };
      }

      // Step 2: Deep scrape one batch
      let deepResult = null;
      const timeSinceDeep = Date.now() - deepCacheTimestamp;
      const deepCacheSize = Object.keys(deepCache).length;
      const allCached = deepCacheSize >= TOTAL_CONSTITUENCIES;

      if (!allCached || timeSinceDeep > 120000) {
        deepResult = await deepScrapeOneBatch();
        // Persist updated cache to KV (non-blocking)
        if (deepResult) {
          env.ELECTION_CACHE && env.ELECTION_CACHE.put(KV_KEY, JSON.stringify({
            data: deepCache,
            timestamp: deepCacheTimestamp,
            currentBatch,
            savedAt: new Date().toISOString()
          })).catch(() => {});
        }
      }
      // Always persist party HWM to KV after each request (non-blocking)
      if (env.ELECTION_CACHE && Object.keys(partyHWM).length > 0) {
        env.ELECTION_CACHE.put(KV_PARTY_HWM_KEY, JSON.stringify(partyHWM)).catch(() => {});
      }

      return jsonResponse(buildResponse(quick, deepResult, startTime));
    } catch (err) {
      if (Object.keys(deepCache).length > 0) {
        const quick = quickCache || { partySeats: {} };
        const response = buildResponse(quick, null, startTime);
        response.sources.failed = [{ name: 'nepsebajar-v3.1-cf-refresh', error: err.message }];
        return jsonResponse(response);
      }

      return jsonResponse({
        error: 'V3.1-CF scrape failed',
        message: err.message,
        timestamp: new Date().toISOString()
      }, 502);
    }
  }
};
