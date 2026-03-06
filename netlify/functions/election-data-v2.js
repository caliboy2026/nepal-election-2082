// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — NepseBarjar Scraper v2 (Quick)
// Fetches main page: directWinData + parliamentChartData
// Output format matches v1 so frontend works with both
// ═══════════════════════════════════════════════════════════

const NEPSEBAJAR_URL = 'https://election.nepsebajar.com/en';

// ── Party ID → short code mapping ──
const PARTY_ID_MAP = {
  41: 'RSP',   // Rastriya Swatantra Party
  2:  'NC',    // Nepali Congress
  1:  'UML',   // CPN-UML
  275:'NCP',   // Nepali Communist Party
  4:  'JSP',   // Janata Samajwadi Party
  5:  'RPP',   // Rastriya Prajatantra Party
  273:'SSP',   // Shram Sanskriti Party
  274:'UNP',   // Ujyalo Nepal Party
  200:'IND',   // Independent
  277:'PLP',   // Pragatishil Loktantrik Party
};

// Fallback: match party name strings
const PARTY_NAME_MAP = {
  'rastriya swatantra party': 'RSP', 'swatantra': 'RSP',
  'nepali congress': 'NC', 'congress': 'NC',
  'cpn-uml': 'UML', 'cpn (uml)': 'UML', 'nepal communist party (uml)': 'UML',
  'nepali communist party': 'NCP', 'maoist': 'NCP',
  'rastriya prajatantra party': 'RPP', 'prajatantra': 'RPP',
  'janata samajwadi party': 'JSP', 'samajwadi': 'JSP',
  'shram sanskriti party': 'SSP', 'shram sanskriti': 'SSP',
  'ujyalo nepal party': 'UNP', 'ujyalo': 'UNP',
  'independent': 'IND',
};

function normalizeParty(partyId, partyName) {
  // First try by ID (most reliable)
  if (partyId && PARTY_ID_MAP[partyId]) return PARTY_ID_MAP[partyId];
  // Fallback to name matching
  if (!partyName) return 'OTH';
  const lower = partyName.toLowerCase().trim();
  for (const [key, val] of Object.entries(PARTY_NAME_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return 'OTH';
}

// District code → province mapping (Nepal's 77 districts across 7 provinces)
const DCODE_TO_PROVINCE = {
  // Koshi (Province 1)
  1:'Koshi',2:'Koshi',3:'Koshi',4:'Koshi',5:'Koshi',6:'Koshi',7:'Koshi',
  8:'Koshi',9:'Koshi',10:'Koshi',11:'Koshi',12:'Koshi',13:'Koshi',14:'Koshi',
  // Madhesh (Province 2)
  15:'Madhesh',16:'Madhesh',17:'Madhesh',18:'Madhesh',19:'Madhesh',20:'Madhesh',
  21:'Madhesh',22:'Madhesh',
  // Bagmati (Province 3)
  23:'Bagmati',24:'Bagmati',25:'Bagmati',26:'Bagmati',27:'Bagmati',28:'Bagmati',
  29:'Bagmati',30:'Bagmati',31:'Bagmati',32:'Bagmati',33:'Bagmati',34:'Bagmati',35:'Bagmati',
  // Gandaki (Province 4)
  36:'Gandaki',37:'Gandaki',38:'Gandaki',39:'Gandaki',40:'Gandaki',41:'Gandaki',
  42:'Gandaki',43:'Gandaki',44:'Gandaki',45:'Gandaki',46:'Gandaki',
  // Lumbini (Province 5)
  47:'Lumbini',48:'Lumbini',49:'Lumbini',50:'Lumbini',51:'Lumbini',52:'Lumbini',
  53:'Lumbini',54:'Lumbini',55:'Lumbini',56:'Lumbini',57:'Lumbini',58:'Lumbini',
  // Karnali (Province 6)
  59:'Karnali',60:'Karnali',61:'Karnali',62:'Karnali',63:'Karnali',64:'Karnali',
  65:'Karnali',66:'Karnali',67:'Karnali',68:'Karnali',
  // Sudurpashchim (Province 7)
  69:'Sudurpashchim',70:'Sudurpashchim',71:'Sudurpashchim',72:'Sudurpashchim',
  73:'Sudurpashchim',74:'Sudurpashchim',75:'Sudurpashchim',76:'Sudurpashchim',77:'Sudurpashchim',
};

// District code → English district name
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

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Nepal-Election-Dashboard/2.0)',
        'Accept': 'text/html, */*'
      }
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function parseMainPage(html) {
  const result = { parties: {}, constituencies: [], partySeats: {} };

  // ── 1. Parse parliamentChartData → party seat totals ──
  const pcMatch = html.match(/parliamentChartData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (pcMatch) {
    try {
      const pcData = JSON.parse(pcMatch[1]);
      for (const entry of pcData) {
        if (entry.PartyID === 0) continue; // "बाँकी" = remaining
        const key = normalizeParty(entry.PartyID, entry.name);
        const totalSeats = entry.y || 0;
        const prSeats = entry.propPortion || 0;
        const directSeats = totalSeats - prSeats;
        // Parliament chart shows total won+leading combined as "y"
        // We can't perfectly split won vs leading from this alone
        // but directWinData below gives us per-constituency status
        result.partySeats[key] = { total: totalSeats, direct: directSeats, pr: prSeats };
      }
    } catch (e) {
      console.log('parliamentChartData parse error:', e.message);
    }
  }

  // ── 2. Parse directWinData → constituency leaders + party won/leading counts ──
  const dwMatch = html.match(/directWinData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (dwMatch) {
    try {
      const dwData = JSON.parse(dwMatch[1]);
      const partyWon = {};
      const partyLeading = {};

      for (const entry of dwData) {
        const partyKey = normalizeParty(entry.party_id, entry.party_name);
        const district = DCODE_TO_DISTRICT[entry.DCODE] || `District${entry.DCODE}`;
        const province = DCODE_TO_PROVINCE[entry.DCODE] || '';
        const constName = `${district}-${entry.F_CONST}`;

        // Track won vs leading per party
        if (entry.status === 'WIN') {
          partyWon[partyKey] = (partyWon[partyKey] || 0) + 1;
        } else {
          partyLeading[partyKey] = (partyLeading[partyKey] || 0) + 1;
        }

        // Build constituency entry (only leader from main page)
        result.constituencies.push({
          name: constName,
          normalizedName: constName.toLowerCase().replace(/\s+/g, ''),
          province: province,
          counted: '', // detail pages have this
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

      // Build party summary from directWinData
      const allPartyKeys = new Set([...Object.keys(partyWon), ...Object.keys(partyLeading)]);
      for (const key of allPartyKeys) {
        result.parties[key] = {
          won: partyWon[key] || 0,
          leading: partyLeading[key] || 0
        };
      }
    } catch (e) {
      console.log('directWinData parse error:', e.message);
    }
  }

  return result;
}

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

  try {
    const res = await fetchWithTimeout(NEPSEBAJAR_URL);
    const html = await res.text();
    const parsed = parseMainPage(html);

    const response = {
      timestamp: new Date().toISOString(),
      fetchDurationMs: Date.now() - startTime,
      sources: {
        successful: [{
          name: 'nepsebajar-v2',
          parties: Object.keys(parsed.parties).length,
          constituencies: parsed.constituencies.length,
          partySeats: parsed.partySeats
        }],
        failed: []
      },
      data: {
        parties: parsed.parties,
        constituencies: parsed.constituencies,
        partySeats: parsed.partySeats,
        meta: {
          totalSeats: 275,
          fptpSeats: 165,
          prSeats: 110,
          majorityMark: 138
        }
      }
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch nepsebajar',
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
