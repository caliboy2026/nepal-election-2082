// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — Hybrid Proxy API
// Fetches live data from multiple sources, falls back gracefully
// Deployed as a Netlify serverless function
// ═══════════════════════════════════════════════════════════

const SOURCES = [
  {
    name: 'ekantipur-party',
    url: 'https://election.ekantipur.com/api/results?type=party&lng=eng',
    type: 'party'
  },
  {
    name: 'ekantipur-constituency',
    url: 'https://election.ekantipur.com/api/results?type=constituency&lng=eng',
    type: 'constituency'
  },
  {
    name: 'ekantipur-hotseats',
    url: 'https://election.ekantipur.com/api/hot-seats?lng=eng',
    type: 'hotseats'
  }
];

// Party name normalization map
const PARTY_MAP = {
  'rastriya swatantra party': 'RSP',
  'rsp': 'RSP',
  'nepali congress': 'NC',
  'cpn-uml': 'UML',
  'cpn (uml)': 'UML',
  'nepal communist party (uml)': 'UML',
  'cpn (unified marxist-leninist)': 'UML',
  'nepali communist party': 'NCP',
  'nepal communist party (maoist centre)': 'NCP',
  'nepal communist party (maoist center)': 'NCP',
  'ncp (maoist centre)': 'NCP',
  'rastriya prajatantra party': 'RPP',
  'shram sanskriti party': 'SSP',
  'janata samajwadi party': 'JSP',
  'janata samjbadi party-nepal': 'JSP',
  'ujyalo nepal party': 'UNP',
  'ujjyalo nepal party': 'UNP',
};

function normalizeParty(name) {
  if (!name) return 'OTH';
  const lower = name.toLowerCase().trim();
  return PARTY_MAP[lower] || 'OTH';
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Nepal-Election-Dashboard/1.0',
        'Accept': 'application/json, text/html, */*'
      }
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchSource(source) {
  try {
    const res = await fetchWithTimeout(source.url);
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return { source: source.name, type: source.type, data: await res.json(), ok: true };
    }

    // If HTML, try to extract embedded JSON data
    const html = await res.text();

    // Look for common patterns: JSON in script tags, __NEXT_DATA__, etc.
    const jsonPatterns = [
      /window\.__data__\s*=\s*({[\s\S]*?});/,
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/,
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    ];

    for (const pattern of jsonPatterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          return { source: source.name, type: source.type, data: JSON.parse(match[1]), ok: true };
        } catch (e) { /* continue */ }
      }
    }

    // Return raw HTML for parsing
    return { source: source.name, type: source.type, data: html, ok: true, format: 'html' };
  } catch (err) {
    return { source: source.name, type: source.type, ok: false, error: err.message };
  }
}

function parsePartyResults(sourceData) {
  const parties = {};

  for (const result of sourceData) {
    if (!result.ok || result.type !== 'party') continue;
    const data = result.data;

    // Handle ekantipur party format
    if (data?.party_wise_results) {
      for (const p of data.party_wise_results) {
        const key = normalizeParty(p.party_name);
        if (!parties[key]) parties[key] = { won: 0, leading: 0 };
        parties[key].won = Math.max(parties[key].won, p.wins || 0);
        parties[key].leading = Math.max(parties[key].leading, p.leading || p.lead || 0);
      }
    }

    // Handle direct object format
    if (data?.results) {
      for (const [name, vals] of Object.entries(data.results)) {
        const key = normalizeParty(name);
        if (!parties[key]) parties[key] = { won: 0, leading: 0 };
        parties[key].won = Math.max(parties[key].won, vals.win || vals.won || 0);
        parties[key].leading = Math.max(parties[key].leading, vals.lead || vals.leading || 0);
      }
    }
  }

  return parties;
}

function parseConstituencyResults(sourceData) {
  const constituencies = [];

  for (const result of sourceData) {
    if (!result.ok) continue;
    const data = result.data;

    // Handle array of constituencies
    if (Array.isArray(data)) {
      for (const c of data) {
        if (c.constituency || c.name) {
          constituencies.push({
            name: c.constituency || c.name,
            province: c.province || c.state || '',
            counted: c.counted || c.booths_counted || '',
            candidates: (c.candidates || []).map(cand => ({
              name: cand.name || cand.candidate_name,
              party: normalizeParty(cand.party || cand.party_name),
              votes: cand.votes || cand.vote_count || 0,
              photo: cand.photo || cand.image || ''
            }))
          });
        }
      }
    }

    // Handle nested constituency format
    if (data?.constituencies) {
      for (const c of data.constituencies) {
        constituencies.push({
          name: c.name || c.constituency,
          province: c.province || '',
          counted: c.counted || '',
          candidates: (c.candidates || []).map(cand => ({
            name: cand.name,
            party: normalizeParty(cand.party),
            votes: cand.votes || 0,
            photo: cand.photo || ''
          }))
        });
      }
    }
  }

  return constituencies;
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30, s-maxage=30'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const startTime = Date.now();

  // Fetch all sources in parallel
  const results = await Promise.all(SOURCES.map(fetchSource));

  const successfulSources = results.filter(r => r.ok).map(r => r.source);
  const failedSources = results.filter(r => !r.ok).map(r => ({ source: r.source, error: r.error }));

  // Parse and merge data
  const parties = parsePartyResults(results);
  const constituencies = parseConstituencyResults(results);

  const response = {
    timestamp: new Date().toISOString(),
    fetchDurationMs: Date.now() - startTime,
    sources: {
      successful: successfulSources,
      failed: failedSources
    },
    data: {
      parties,
      constituencies,
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
};
