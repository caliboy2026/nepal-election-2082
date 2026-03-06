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
// Extracts party results and constituency data from embedded JS
function parseEkantipurHTML(html) {
  const result = { parties: {}, constituencies: [] };

  // 1. Extract party data from HTML
  // Look for patterns like: party_name: "RSP", win: 1, lead: 52
  // Or table rows with party names and numbers
  const partyPatterns = [
    // JS object format: {party_name: "...", win: N, lead: N}
    /party_name['":\s]*['"]([^'"]+)['"][^}]*?win['":\s]*(\d+)[^}]*?lead['":\s]*(\d+)/gi,
    // Reverse order: lead then win
    /party_name['":\s]*['"]([^'"]+)['"][^}]*?lead['":\s]*(\d+)[^}]*?win['":\s]*(\d+)/gi,
  ];

  for (const pat of partyPatterns) {
    let match;
    while ((match = pat.exec(html)) !== null) {
      const key = normalizeParty(match[1]);
      const won = parseInt(match[2]) || 0;
      const leading = parseInt(match[3]) || 0;
      if (!result.parties[key]) result.parties[key] = { won: 0, leading: 0 };
      result.parties[key].won = Math.max(result.parties[key].won, won);
      result.parties[key].leading = Math.max(result.parties[key].leading, leading);
    }
  }

  // Also try: "Win" and "Lead" as separate numbers near party names in HTML tables
  const tablePartyPattern = /<td[^>]*>([^<]*(?:Swatantra|Congress|UML|Maoist|Prajatantra|Shram|Samajwadi|Ujyalo|Ujaylo)[^<]*)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>/gi;
  let tMatch;
  while ((tMatch = tablePartyPattern.exec(html)) !== null) {
    const key = normalizeParty(tMatch[1]);
    const num1 = parseInt(tMatch[2]) || 0;
    const num2 = parseInt(tMatch[3]) || 0;
    if (!result.parties[key]) result.parties[key] = { won: 0, leading: 0 };
    // Smaller number is usually won, larger is leading
    result.parties[key].won = Math.max(result.parties[key].won, Math.min(num1, num2));
    result.parties[key].leading = Math.max(result.parties[key].leading, Math.max(num1, num2));
  }

  // 2. Extract competiviveDist data (constituency results)
  // Format: competiviveDist = {"jhapa-5": [{name: "...", vote_count: N, party_name: "..."}]}
  const compMatch = html.match(/competiviveDist\s*=\s*(\{[\s\S]*?\});\s*(?:var|let|const|function|<\/script>)/);
  if (compMatch) {
    try {
      // Convert JS object to valid JSON (handle unquoted keys)
      let jsObj = compMatch[1];
      // Replace single quotes with double quotes
      jsObj = jsObj.replace(/'/g, '"');
      // Quote unquoted keys: word: -> "word":
      jsObj = jsObj.replace(/(\w+)\s*:/g, '"$1":');
      // Fix double-quoted keys that were already quoted
      jsObj = jsObj.replace(/""/g, '"');

      const constData = JSON.parse(jsObj);
      for (const [constKey, candidates] of Object.entries(constData)) {
        if (Array.isArray(candidates) && candidates.length > 0) {
          // Convert "jhapa-5" to "Jhapa-5"
          const constName = constKey.replace(/\b\w/g, c => c.toUpperCase());
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
            })).filter(c => c.name)
          });
        }
      }
    } catch (e) {
      // JS object parsing failed — try extracting individual candidates
      console.log('competitiveDist parse failed:', e.message);
    }
  }

  // 3. Fallback: extract individual candidate entries from HTML
  // Pattern: name, party, vote_count scattered in JS data
  const candPattern = /name['":\s]*['"]([^'"]{3,50})['"][^}]*?party_name['":\s]*['"]([^'"]+)['"][^}]*?vote_count['":\s]*(\d+)/gi;
  const candsByConst = {};
  let cMatch;
  while ((cMatch = candPattern.exec(html)) !== null) {
    const name = cMatch[1];
    const party = normalizeParty(cMatch[2]);
    const votes = parseInt(cMatch[3]) || 0;

    // Try to find constituency from nearby context
    const nearby = html.substring(Math.max(0, cMatch.index - 200), cMatch.index);
    const distMatch = nearby.match(/district_name['":\s]*['"](\w+)['"][^}]*?region_num['":\s]*(\d+)/i) ||
                      nearby.match(/['"](\w+-\d+)['"]/);
    if (distMatch) {
      const constName = distMatch[2] ? `${distMatch[1]}-${distMatch[2]}` : distMatch[1];
      const normName = normalizeConstName(constName);
      if (!candsByConst[normName]) {
        candsByConst[normName] = {
          name: constName.replace(/\b\w/g, c => c.toUpperCase()),
          normalizedName: normName,
          candidates: []
        };
      }
      candsByConst[normName].candidates.push({ name, party, votes });
    }
  }

  // Merge individual candidates into constituency results (avoid duplicates)
  for (const [normName, constData] of Object.entries(candsByConst)) {
    const existing = result.constituencies.find(c => c.normalizedName === normName);
    if (!existing && constData.candidates.length > 0) {
      result.constituencies.push(constData);
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
