// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — V3 Server-Side Accumulated Scraper
//
// Combines quick scrape + deep scrape in one function.
// Uses module-level globals to persist data across warm invocations.
//
// Every call:
//   1. Returns cached deep data immediately (if available)
//   2. Always does quick scrape (main page: leaders + party seats)
//   3. Scrapes ONE batch of constituency detail pages in background
//   4. Merges into accumulated cache for next caller
//
// Result: First caller gets quick data. After ~11 calls (one per batch),
// the full 165-constituency dataset is built. All subsequent callers
// get the complete picture instantly.
// ═══════════════════════════════════════════════════════════

const NEPSEBAJAR_URL = 'https://election.nepsebajar.com/en';
const BATCH_SIZE = 15;

// ═══ PERSISTENT STATE (survives across warm invocations) ═══
let deepCache = {};          // pdniCenterId → constituency data
let deepCacheTimestamp = 0;  // when cache was last updated
let currentBatch = 0;        // which batch to scrape next
let masterList = null;        // cached constituency list from main page
let masterListTimestamp = 0;  // when master list was fetched
let totalBatches = 11;
let quickCache = null;        // last quick scrape result
let quickCacheTimestamp = 0;

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

// ── District/Province lookups ──
const DCODE_TO_DISTRICT = {
  1:'Taplejung',2:'Panchthar',3:'Ilam',4:'Jhapa',5:'Sankhuwasabha',6:'Terhathum',
  7:'Bhojpur',8:'Dhankuta',9:'Morang',10:'Sunsari',11:'Solukhumbu',12:'Okhaldhunga',
  13:'Khotang',14:'Udayapur',15:'Saptari',16:'Siraha',17:'Dhanusha',18:'Mahottari',
  19:'Sarlahi',20:'Rautahat',21:'Bara',22:'Parsa',23:'Dolakha',24:'Sindhupalchok',
  25:'Rasuwa',26:'Dhading',27:'Nuwakot',28:'Kathmandu',29:'Bhaktapur',30:'Lalitpur',
  31:'Kavrepalanchok',32:'Ramechhap',33:'Sindhuli',34:'Makwanpur',35:'Chitwan',
  36:'Manang',37:'Mustang',38:'Myagdi',39:'Kaski',40:'Lamjung',41:'Gorkha',
  42:'Tanahu',43:'Nawalparasi_E',44:'Syangja',45:'Parbat',46:'Baglung',
  47:'Gulmi',48:'Palpa',49:'Nawalparasi_W',50:'Rupandehi',51:'Kapilvastu',
  52:'Arghakhanchi',53:'Pyuthan',54:'Rolpa',55:'Dang',56:'Banke',57:'Bardiya',
  58:'Rukum_E',59:'Rukum_W',60:'Salyan',61:'Dolpa',62:'Jumla',63:'Kalikot',
  64:'Mugu',65:'Humla',66:'Jajarkot',67:'Dailekh',68:'Surkhet',
  69:'Bajura',70:'Bajhang',71:'Darchula',72:'Baitadi',73:'Dadeldhura',
  74:'Doti',75:'Achham',76:'Kailali',77:'Kanchanpur',
};

const DCODE_TO_PROVINCE = {
  1:'Koshi',2:'Koshi',3:'Koshi',4:'Koshi',5:'Koshi',6:'Koshi',7:'Koshi',
  8:'Koshi',9:'Koshi',10:'Koshi',11:'Koshi',12:'Koshi',13:'Koshi',14:'Koshi',
  15:'Madhesh',16:'Madhesh',17:'Madhesh',18:'Madhesh',19:'Madhesh',20:'Madhesh',
  21:'Madhesh',22:'Madhesh',
  23:'Bagmati',24:'Bagmati',25:'Bagmati',26:'Bagmati',27:'Bagmati',28:'Bagmati',
  29:'Bagmati',30:'Bagmati',31:'Bagmati',32:'Bagmati',33:'Bagmati',34:'Bagmati',35:'Bagmati',
  36:'Gandaki',37:'Gandaki',38:'Gandaki',39:'Gandaki',40:'Gandaki',41:'Gandaki',
  42:'Gandaki',43:'Gandaki',44:'Gandaki',45:'Gandaki',46:'Gandaki',
  47:'Lumbini',48:'Lumbini',49:'Lumbini',50:'Lumbini',51:'Lumbini',52:'Lumbini',
  53:'Lumbini',54:'Lumbini',55:'Lumbini',56:'Lumbini',57:'Lumbini',58:'Lumbini',
  59:'Karnali',60:'Karnali',61:'Karnali',62:'Karnali',63:'Karnali',64:'Karnali',
  65:'Karnali',66:'Karnali',67:'Karnali',68:'Karnali',
  69:'Sudurpashchim',70:'Sudurpashchim',71:'Sudurpashchim',72:'Sudurpashchim',
  73:'Sudurpashchim',74:'Sudurpashchim',75:'Sudurpashchim',76:'Sudurpashchim',77:'Sudurpashchim',
};

async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Nepal-Election-Dashboard/3.0)',
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

// ═══ QUICK SCRAPE: Main page data ═══
async function quickScrape() {
  const now = Date.now();
  // Use cached quick data if less than 20 seconds old
  if (quickCache && (now - quickCacheTimestamp) < 20000) {
    return quickCache;
  }

  const res = await fetchWithTimeout(NEPSEBAJAR_URL, 8000);
  const html = await res.text();

  const result = { parties: {}, constituencies: [], partySeats: {} };

  // Parse parliamentChartData → party seat totals
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
          pr: entry.propPortion || 0
        };
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Parse directWinData → leaders + party won/leading
  const dwMatch = html.match(/directWinData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (dwMatch) {
    try {
      const dwData = JSON.parse(dwMatch[1]);
      const partyWon = {}, partyLeading = {};

      // Cache the master list for deep scraping
      masterList = dwData;
      masterListTimestamp = now;
      totalBatches = Math.ceil(dwData.length / BATCH_SIZE);

      for (const entry of dwData) {
        const partyKey = normalizePartyById(entry.party_id, entry.party_name);
        const district = DCODE_TO_DISTRICT[entry.DCODE] || `District${entry.DCODE}`;
        const province = DCODE_TO_PROVINCE[entry.DCODE] || '';
        const constName = `${district}-${entry.F_CONST}`;

        if (entry.status === 'WIN') {
          partyWon[partyKey] = (partyWon[partyKey] || 0) + 1;
        } else {
          partyLeading[partyKey] = (partyLeading[partyKey] || 0) + 1;
        }

        result.constituencies.push({
          name: constName,
          normalizedName: constName.toLowerCase().replace(/\s+/g, ''),
          province: province,
          counted: '',
          pdniCenterId: entry.pdni_center_id,
          candidates: [{
            name: entry.candidate_name || '',
            party: partyKey,
            votes: entry.votes || 0,
            photo: '',
            partyColor: entry.party_color || ''
          }]
        });
      }

      const allKeys = new Set([...Object.keys(partyWon), ...Object.keys(partyLeading)]);
      for (const key of allKeys) {
        result.parties[key] = { won: partyWon[key] || 0, leading: partyLeading[key] || 0 };
      }
    } catch (e) { /* ignore parse errors */ }
  }

  quickCache = result;
  quickCacheTimestamp = now;
  return result;
}

// ═══ DEEP SCRAPE: One batch of constituency detail pages ═══
function parseConstituencyPage(html, entry) {
  const candidates = [];
  const district = DCODE_TO_DISTRICT[entry.DCODE] || `District${entry.DCODE}`;
  const province = DCODE_TO_PROVINCE[entry.DCODE] || '';
  const constName = `${district}-${entry.F_CONST}`;

  const candidateRegex = /candidate\/(\d+)\/([^/]+)\/elec2082[\s\S]*?<h4[^>]*>\s*([^<]+)\s*<\/h4>[\s\S]*?text-\[10px\][^>]*>\s*([^<]*)\s*<[\s\S]*?font-bold[^>]*>\s*([0-9,]+)\s*<\/span>/g;

  let m;
  while ((m = candidateRegex.exec(html)) !== null) {
    candidates.push({
      name: m[3].trim(),
      party: normalizePartyByName(m[4].trim()),
      partyFull: m[4].trim(),
      votes: parseInt(m[5].replace(/,/g, '')) || 0,
      candidateId: m[1],
      slug: m[2],
      photo: ''
    });
  }

  // Extract photo URLs
  const photoMap = {};
  const photoRegex = /img\/candidates\/([^"]+\.jpg)[\s\S]*?candidate\/(\d+)\//g;
  let pm;
  while ((pm = photoRegex.exec(html)) !== null) {
    photoMap[pm[2]] = `https://election.nepsebajar.com/img/candidates/${pm[1]}`;
  }
  const photoRegex2 = /candidate\/(\d+)\/[\s\S]*?img\/candidates\/([^"]+\.jpg)/g;
  while ((pm = photoRegex2.exec(html)) !== null) {
    if (!photoMap[pm[1]]) {
      photoMap[pm[1]] = `https://election.nepsebajar.com/img/candidates/${pm[2]}`;
    }
  }
  for (const c of candidates) {
    if (photoMap[c.candidateId]) c.photo = photoMap[c.candidateId];
  }

  candidates.sort((a, b) => b.votes - a.votes);

  return {
    name: constName,
    normalizedName: constName.toLowerCase().replace(/\s+/g, ''),
    province,
    district,
    fConst: entry.F_CONST,
    pdniCenterId: entry.pdni_center_id,
    counted: '',
    totalCandidates: candidates.length,
    candidates
  };
}

async function deepScrapeOneBatch() {
  if (!masterList || masterList.length === 0) return { fetched: 0, failed: 0 };

  const startIdx = currentBatch * BATCH_SIZE;
  const batchEntries = masterList.slice(startIdx, startIdx + BATCH_SIZE);
  if (batchEntries.length === 0) {
    currentBatch = 0; // wrap around
    return { fetched: 0, failed: 0 };
  }

  let fetched = 0, failed = 0;

  const results = await Promise.allSettled(
    batchEntries.map(async (entry) => {
      try {
        const url = `https://election.nepsebajar.com/en/pratinidhi/${entry.pdni_center_id}`;
        const res = await fetchWithTimeout(url);
        const html = await res.text();
        return { ok: true, data: parseConstituencyPage(html, entry) };
      } catch (err) {
        return { ok: false, id: entry.pdni_center_id };
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      const constData = r.value.data;
      // Only update cache if we got real candidate data
      if (constData.candidates.length > 0) {
        const existing = deepCache[constData.pdniCenterId];
        // Only accept if more candidates or higher top votes (no regression)
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

  // Advance batch (wraps around)
  currentBatch = (currentBatch + 1) % totalBatches;

  return { fetched, failed };
}

// ═══ MERGE: Combine quick data with deep cache ═══
function buildResponse(quick, deepResult, startTime) {
  const constituencies = [];
  const deepCacheSize = Object.keys(deepCache).length;

  for (const qc of quick.constituencies) {
    const deepData = deepCache[qc.pdniCenterId];
    if (deepData && deepData.candidates.length > 0) {
      // Use deep data (full candidate list with photos)
      constituencies.push(deepData);
    } else {
      // Fall back to quick data (leader only)
      constituencies.push(qc);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    fetchDurationMs: Date.now() - startTime,
    sources: {
      successful: [{
        name: 'nepsebajar-v3',
        parties: Object.keys(quick.parties).length,
        constituencies: constituencies.length,
        deepCached: deepCacheSize,
        partySeats: quick.partySeats
      }],
      failed: []
    },
    data: {
      parties: quick.parties,
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
      totalConstituencies: quick.constituencies.length,
      currentBatch,
      totalBatches,
      deepCacheAge: deepCacheTimestamp ? Math.round((Date.now() - deepCacheTimestamp) / 1000) : null,
      deepBatchResult: deepResult
    }
  };
}

// ═══ HANDLER ═══
exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30, s-maxage=30'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const startTime = Date.now();
  const params = event.queryStringParameters || {};

  // ?status=true → return just the cache status (for debugging)
  if (params.status) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        deepCached: Object.keys(deepCache).length,
        totalBatches,
        currentBatch,
        deepCacheAge: deepCacheTimestamp ? Math.round((Date.now() - deepCacheTimestamp) / 1000) : null,
        quickCacheAge: quickCacheTimestamp ? Math.round((Date.now() - quickCacheTimestamp) / 1000) : null,
        masterListAge: masterListTimestamp ? Math.round((Date.now() - masterListTimestamp) / 1000) : null,
      })
    };
  }

  try {
    // Step 1: Quick scrape (always — fast, ~1s)
    const quick = await quickScrape();

    // Step 2: Deep scrape one batch (piggybacks on this request)
    // Skip if we've completed a full cycle recently (< 2 min ago) to be gentle
    let deepResult = null;
    const timeSinceDeep = Date.now() - deepCacheTimestamp;
    const deepCacheSize = Object.keys(deepCache).length;
    const allCached = deepCacheSize >= (quick.constituencies?.length || 165);

    // Always scrape if we don't have full coverage yet
    // Once full, only scrape if cache is older than 2 minutes
    if (!allCached || timeSinceDeep > 120000) {
      deepResult = await deepScrapeOneBatch();
    }

    const response = buildResponse(quick, deepResult, startTime);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
  } catch (err) {
    // If quick scrape fails but we have cached deep data, return that
    if (Object.keys(deepCache).length > 0 && quickCache) {
      const response = buildResponse(quickCache, null, startTime);
      response.sources.failed = [{ name: 'nepsebajar-v3-refresh', error: err.message }];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response)
      };
    }

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'V3 scrape failed',
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
