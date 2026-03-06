// ═══════════════════════════════════════════════════════════
// Nepal Election 2082 — Fail-Proof Proxy API v3
// Handles Ekantipur HTML+JS responses, multiple fallbacks
// ═══════════════════════════════════════════════════════════

// We only fetch Ekantipur's main page since their "API" returns HTML
// Then parse the embedded JS data (competiviveDist, party tables, etc.)
const SOURCES = [
  {
    name: 'ekantipur-main',
    url: 'https://election.ekantipur.com/?lng=eng',
    type: 'ekantipur-html'
  },
  {
    name: 'ekantipur-party',
    url: 'https://election.ekantipur.com/api/results?type=party&lng=eng',
    type: 'ekantipur-html'
  },
  {
    name: 'nepsebajar',
    url: 'https://election.nepsebajar.com/en',
    type: 'html-scrape'
  }
];

// Expanded party name normalization
const PARTY_MAP = {
  'rastriya swatantra party': 'RSP', 'rsp': 'RSP', 'swatantra': 'RSP',
  'nepali congress': 'NC', 'congress': 'NC', 'nc': 'NC',
  'cpn-uml': 'UML', 'cpn (uml)': 'UML', 'cpn(uml)': 'UML',
  'nepal communist party (uml)': 'UML', 'cpn (unified marxist-leninist)': 'UML',
  'cpn (unified marxist–leninist)': 'UML', 'uml': 'UML',
  'nepali communist party': 'NCP', 'nepal communist party (maoist centre)': 'NCP',
  'nepal communist party (maoist center)': 'NCP', 'ncp (maoist centre)': 'NCP',
  'ncp (maoist center)': 'NCP', 'cpn (maoist centre)': 'NCP',
  'cpn (maoist center)': 'NCP', 'cpn-mc': 'NCP', 'maoist centre': 'NCP',
  'maoist center': 'NCP', 'ncp': 'NCP',
  'rastriya prajatantra party': 'RPP', 'rpp': 'RPP',
  'shram sanskriti party': 'SSP', 'ssp': 'SSP',
  'janata samajwadi party': 'JSP', 'janata samajwadi party-nepal': 'JSP',
  'janata samjbadi party-nepal': 'JSP', 'jsp': 'JSP',
  'ujyalo nepal party': 'UNP', 'ujjyalo nepal party': 'UNP',
  'ujaylo nepal party': 'UNP', 'unp': 'UNP',
};

function normalizeParty(name) {
  if (!name) return 'OTH';
  const lower = name.toLowerCase().trim();
  if (PARTY_MAP[lower]) return PARTY_MAP[lower];
  for (const [key, val] of Object.entries(PARTY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return 'OTH';
}

function normalizeConstName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/\s+/g, '').replace(/[-–—]+/g, '-').replace(/[^\w-]/g, '').trim();
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Nepal-Election-Dashboard/2.0)',
        'Accept': 'text/html, application/json, */*'
      }
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ═══ EKANTIPUR HTML PARSER ═══
// Ekantipur returns HTML, not JSON. Data is in:
// 1. Party results: HTML links like /party/7/elected with "1" and /party/7/leading with "56"
// 2. Constituency results: JS variable "competiviveDist" with candidate objects
function parseEkantipurHTML(html) {
  const result = { parties: {}, constituencies: [] };
  const MAX_SEATS = 165;

  // ── PARTY DATA ──
  // Ekantipur format: each party is a block starting with /party/N?
  // containing party name, then /party/N/elected with won count, /party/N/leading with lead count
  const partyBlocks = html.split(/(?=<a[^>]*href=["']\/party\/\d+\?)/i);
  for (const block of partyBlocks) {
    // Match elected/leading counts — handles both ">\s*5" and ">\s*[5]" formats
    const electedMatch = block.match(/\/elected[^>]*>\s*\[?(\d+)\]?/);
    const leadingMatch = block.match(/\/leading[^>]*>\s*\[?(\d+)\]?/);
    if (!electedMatch || !leadingMatch) continue;

    // Find party name in this block — look for text inside the first <a> tag
    const nameMatch = block.match(/>([^<]*(?:Party|Congress|UML|Maoist|Communist|Prajatantra|Shram|Samajwadi|Samjbadi|Ujyalo|Ujaylo|Ujjyalo|Independent|Swatantra)[^<]*)</i);
    if (!nameMatch) continue;

    const key = normalizeParty(nameMatch[1].trim());
    const won = parseInt(electedMatch[1]) || 0;
    const leading = parseInt(leadingMatch[1]) || 0;

    if (won > MAX_SEATS || leading > MAX_SEATS) continue;
    if (!result.parties[key]) result.parties[key] = { won: 0, leading: 0 };
    result.parties[key].won = Math.max(result.parties[key].won, won);
    result.parties[key].leading = Math.max(result.parties[key].leading, leading);
  }

  // ── CONSTITUENCY DATA from competiviveDist ──
  // Format: competiviveDist = {"jhapa-5": [{id, name, vote_count, party_name, image, ...}]}
  // Use a greedy match since the object can be large
  // Match the full competiviveDist object — use greedy match up to the closing }; on its own
  // The lazy [\s\S]*? can stop too early at nested objects, so we match balanced braces
  const compMatch = html.match(/competiviveDist\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:const|var|let|function|<\/script)/);
  // Fallback to original lazy match if the above doesn't work
  const compMatchFallback = compMatch || html.match(/competiviveDist\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (compMatchFallback) {
    try {
      // The data is already valid JSON (quoted keys from Ekantipur's server)
      const constData = JSON.parse(compMatchFallback[1]);
      for (const [constKey, candidates] of Object.entries(constData)) {
        if (Array.isArray(candidates) && candidates.length > 0) {
          const constName = constKey.replace(/(^|-)(\w)/g, (m, sep, c) => sep + c.toUpperCase());
          result.constituencies.push({
            name: constName,
            normalizedName: normalizeConstName(constKey),
            province: candidates[0].pradesh_name || '',
            counted: '',
            candidates: candidates.map(c => ({
              name: c.name || '',
              party: normalizeParty(c.party_name || ''),
              votes: c.vote_count || 0,
              photo: c.image || ''
            })).filter(c => c.name && c.votes > 0)
          });
        }
      }
    } catch (e) {
      // JSON.parse failed — try cleaning the JS object
      try {
        let jsObj = compMatchFallback[1];
        jsObj = jsObj.replace(/'/g, '"');
        jsObj = jsObj.replace(/(\w+)\s*:/g, '"$1":');
        jsObj = jsObj.replace(/""/g, '"');
        const constData = JSON.parse(jsObj);
        for (const [constKey, candidates] of Object.entries(constData)) {
          if (Array.isArray(candidates) && candidates.length > 0) {
            const constName = constKey.replace(/(^|-)(\w)/g, (m, sep, c) => sep + c.toUpperCase());
            result.constituencies.push({
              name: constName,
              normalizedName: normalizeConstName(constKey),
              province: candidates[0].pradesh_name || '',
              counted: '',
              candidates: candidates.map(c => ({
                name: c.name || '',
                party: normalizeParty(c.party_name || ''),
                votes: c.vote_count || 0,
                photo: c.image || ''
              })).filter(c => c.name && c.votes > 0)
            });
          }
        }
      } catch (e2) {
        console.log('competitiveDist parse failed:', e2.message);
      }
    }
  }

  return result;
}

// ═══ GENERIC HTML SCRAPER ═══
function scrapePartyFromHTML(html) {
  const parties = {};

  // Look for common patterns in election sites
  // Pattern 1: Table with party name, won, leading columns
  const rowPattern = /(Rastriya Swatantra|Nepali Congress|CPN[- ]*(?:\()?UML|Communist.*?Maoist|Prajatantra|Shram Sanskriti|Samajwadi|Ujyalo|Ujaylo)[\s\S]{0,200}?(\d+)[\s\S]{0,50}?(\d+)/gi;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const key = normalizeParty(match[1]);
    const num1 = parseInt(match[2]) || 0;
    const num2 = parseInt(match[3]) || 0;
    if (!parties[key]) parties[key] = { won: 0, leading: 0 };
    parties[key].won = Math.max(parties[key].won, Math.min(num1, num2));
    parties[key].leading = Math.max(parties[key].leading, Math.max(num1, num2));
  }

  return parties;
}

async function fetchSource(source) {
  try {
    const res = await fetchWithTimeout(source.url);
    const html = await res.text();

    if (source.type === 'ekantipur-html') {
      const parsed = parseEkantipurHTML(html);
      return {
        source: source.name,
        type: 'parsed',
        data: parsed,
        ok: true,
        partyCount: Object.keys(parsed.parties).length,
        constCount: parsed.constituencies.length
      };
    }

    // For other HTML sources, try to scrape party data
    const scrapedParties = scrapePartyFromHTML(html);
    if (Object.keys(scrapedParties).length > 0) {
      return {
        source: source.name,
        type: 'parsed',
        data: { parties: scrapedParties, constituencies: [] },
        ok: true
      };
    }

    return { source: source.name, type: source.type, ok: true, data: { parties: {}, constituencies: [] } };
  } catch (err) {
    return { source: source.name, type: source.type, ok: false, error: err.message };
  }
}

function mergeResults(allResults) {
  const parties = {};
  const constituencies = [];
  const constMap = {};

  for (const result of allResults) {
    if (!result.ok || !result.data) continue;

    // Merge parties (take highest numbers across sources)
    if (result.data.parties) {
      for (const [key, vals] of Object.entries(result.data.parties)) {
        if (!parties[key]) parties[key] = { won: 0, leading: 0 };
        parties[key].won = Math.max(parties[key].won, vals.won || 0);
        parties[key].leading = Math.max(parties[key].leading, vals.leading || 0);
      }
    }

    // Merge constituencies (keep entry with most candidates/highest votes)
    if (result.data.constituencies) {
      for (const c of result.data.constituencies) {
        const normName = c.normalizedName || normalizeConstName(c.name);
        if (!constMap[normName] || c.candidates.length > constMap[normName].candidates.length) {
          constMap[normName] = c;
        }
      }
    }
  }

  return { parties, constituencies: Object.values(constMap) };
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

  // Fetch all sources in parallel
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const resolvedResults = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const successfulSources = resolvedResults.filter(r => r.ok).map(r => ({
    name: r.source,
    parties: r.partyCount || Object.keys(r.data?.parties || {}).length,
    constituencies: r.constCount || (r.data?.constituencies || []).length
  }));
  const failedSources = [
    ...resolvedResults.filter(r => !r.ok).map(r => ({ source: r.source, error: r.error })),
    ...results.filter(r => r.status === 'rejected').map((r, i) => ({ source: SOURCES[i]?.name, error: r.reason?.message }))
  ];

  // Merge all data
  const merged = mergeResults(resolvedResults);

  const response = {
    timestamp: new Date().toISOString(),
    fetchDurationMs: Date.now() - startTime,
    sources: { successful: successfulSources, failed: failedSources },
    data: {
      parties: merged.parties,
      constituencies: merged.constituencies,
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
