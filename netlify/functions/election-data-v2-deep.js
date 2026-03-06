// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — NepseBarjar Deep Scraper v2
// Fetches constituency detail pages in batches
// Call with ?batch=0 (constituencies 0-19), ?batch=1 (20-39), etc.
// Or ?id=55 for a single constituency by pdni_center_id
// ═══════════════════════════════════════════════════════════

const NEPSEBAJAR_URL = 'https://election.nepsebajar.com/en';
const BATCH_SIZE = 15; // Constituencies per batch (keep under 10s timeout)

// ── Party mapping (same as v2.js) ──
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

function normalizeParty(partyName) {
  if (!partyName) return 'OTH';
  const lower = partyName.toLowerCase().trim();
  for (const [key, val] of Object.entries(PARTY_NAME_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  if (lower.includes('independent') || lower.includes('स्वतन्त्र')) return 'IND';
  return 'OTH';
}

// District code → district name + province
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
        'User-Agent': 'Mozilla/5.0 (compatible; Nepal-Election-Dashboard/2.0)',
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

// Get the master constituency list from main page
async function getConstituencyList() {
  const res = await fetchWithTimeout(NEPSEBAJAR_URL, 8000);
  const html = await res.text();
  const dwMatch = html.match(/directWinData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!dwMatch) throw new Error('directWinData not found on main page');
  return JSON.parse(dwMatch[1]);
}

// Parse a constituency detail page for all candidates
function parseConstituencyPage(html, entry) {
  const candidates = [];
  const district = DCODE_TO_DISTRICT[entry.DCODE] || `District${entry.DCODE}`;
  const province = DCODE_TO_PROVINCE[entry.DCODE] || '';
  const constName = `${district}-${entry.F_CONST}`;

  // Extract candidate cards: each has a link to /en/candidate/{id}/{slug}/elec2082
  // followed by name in <h4>, party in small text, votes in bold span
  const candidateRegex = /candidate\/(\d+)\/([^/]+)\/elec2082[\s\S]*?<h4[^>]*>\s*([^<]+)\s*<\/h4>[\s\S]*?text-\[10px\][^>]*>\s*([^<]*)\s*<[\s\S]*?font-bold[^>]*>\s*([0-9,]+)\s*<\/span>/g;

  let m;
  while ((m = candidateRegex.exec(html)) !== null) {
    const votes = parseInt(m[5].replace(/,/g, '')) || 0;
    candidates.push({
      name: m[3].trim(),
      party: normalizeParty(m[4].trim()),
      partyFull: m[4].trim(),
      votes: votes,
      candidateId: m[1],
      slug: m[2],
      photo: '' // Could extract from img tag if needed
    });
  }

  // Try to extract photo URLs for top candidates
  const photoRegex = /img\/candidates\/([^"]+\.jpg)[\s\S]*?candidate\/(\d+)\//g;
  const photoMap = {};
  let pm;
  while ((pm = photoRegex.exec(html)) !== null) {
    photoMap[pm[2]] = `https://election.nepsebajar.com/img/candidates/${pm[1]}`;
  }
  // Also try reverse order (photo before candidate link)
  const photoRegex2 = /candidate\/(\d+)\/[\s\S]*?img\/candidates\/([^"]+\.jpg)/g;
  while ((pm = photoRegex2.exec(html)) !== null) {
    if (!photoMap[pm[1]]) {
      photoMap[pm[1]] = `https://election.nepsebajar.com/img/candidates/${pm[2]}`;
    }
  }
  // Assign photos
  for (const c of candidates) {
    if (photoMap[c.candidateId]) c.photo = photoMap[c.candidateId];
  }

  // Sort by votes descending
  candidates.sort((a, b) => b.votes - a.votes);

  return {
    name: constName,
    normalizedName: constName.toLowerCase().replace(/\s+/g, ''),
    province: province,
    district: district,
    fConst: entry.F_CONST,
    pdniCenterId: entry.pdni_center_id,
    counted: '', // nepsebajar doesn't show booth counts
    totalCandidates: candidates.length,
    candidates: candidates
  };
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60, s-maxage=60'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const startTime = Date.now();
  const params = event.queryStringParameters || {};

  try {
    // Get master list of all constituencies
    const allConstituencies = await getConstituencyList();
    const totalBatches = Math.ceil(allConstituencies.length / BATCH_SIZE);

    // Single constituency mode: ?id=55
    if (params.id) {
      const entry = allConstituencies.find(c => c.pdni_center_id === parseInt(params.id));
      if (!entry) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: `Constituency ID ${params.id} not found` })
        };
      }

      const url = `https://election.nepsebajar.com/en/pratinidhi/${entry.pdni_center_id}`;
      const res = await fetchWithTimeout(url);
      const html = await res.text();
      const parsed = parseConstituencyPage(html, entry);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          fetchDurationMs: Date.now() - startTime,
          mode: 'single',
          constituency: parsed
        })
      };
    }

    // Batch mode: ?batch=0 (default), ?batch=1, etc.
    const batchNum = parseInt(params.batch) || 0;
    const startIdx = batchNum * BATCH_SIZE;
    const batchEntries = allConstituencies.slice(startIdx, startIdx + BATCH_SIZE);

    if (batchEntries.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          mode: 'batch',
          batch: batchNum,
          totalBatches,
          totalConstituencies: allConstituencies.length,
          constituencies: [],
          message: 'No more constituencies in this batch'
        })
      };
    }

    // Fetch all pages in this batch concurrently
    const fetchPromises = batchEntries.map(async (entry) => {
      try {
        const url = `https://election.nepsebajar.com/en/pratinidhi/${entry.pdni_center_id}`;
        const res = await fetchWithTimeout(url);
        const html = await res.text();
        return { ok: true, data: parseConstituencyPage(html, entry) };
      } catch (err) {
        const district = DCODE_TO_DISTRICT[entry.DCODE] || `District${entry.DCODE}`;
        return {
          ok: false,
          error: err.message,
          name: `${district}-${entry.F_CONST}`,
          pdniCenterId: entry.pdni_center_id
        };
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const constituencies = [];
    const errors = [];

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        constituencies.push(r.value.data);
      } else if (r.status === 'fulfilled' && !r.value.ok) {
        errors.push(r.value);
      } else {
        errors.push({ error: r.reason?.message || 'Unknown error' });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        fetchDurationMs: Date.now() - startTime,
        mode: 'batch',
        batch: batchNum,
        totalBatches,
        totalConstituencies: allConstituencies.length,
        batchSize: BATCH_SIZE,
        fetched: constituencies.length,
        failed: errors.length,
        constituencies,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'Deep scrape failed',
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
