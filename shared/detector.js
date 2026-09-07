/**
 * Zillow Power Filters — detection core.
 * Pure functions, no browser APIs: runs in the extension (ES module)
 * and under node --test.
 *
 * Input shape (constructed by the page adapters):
 *   listing = {
 *     resoFacts:   { ... } | null,   // property.resoFacts from __NEXT_DATA__
 *     description: string | null     // listing marketing description
 *   }
 *
 * Every evaluate() returns { status: 'yes'|'no'|'unknown', matched, source }
 *   status  'yes'  listing satisfies the filter
 *           'no'   evidence says it does NOT
 *           'unknown'  not enough data surfaced (very common for rentals)
 *   matched  the concrete tokens that produced the verdict (for the badge tooltip)
 *   source   'structured' | 'description' | 'none'
 */

/* ---------------------------------------------------------------- patterns */

// Neutral phrase guard: when these fire near a gas mention for the SAME item,
// treat as a concern (e.g. "converted the gas range to electric").
const GAS_POSITIVE = /\bgas[\s-]*(range|stove|cooktop|oven)\b/i;
const GAS_ANY = /\b(gas[\s-]*(range|stove|cooktop|oven)|gas\s+cooking)\b/i;
const GAS_CONVERSION_CONCERN =
  /(convert\w*\s+[^.]{0,40}?\bgas\b[^.]{0,40}?\bto\s+electric|\bno\s+gas\b[^.]{0,25}?(range|stove|cooktop|oven))/i;
const ELECTRIC_DEFINITE =
  /(electric\s+(range|stove|cooktop|oven)|induction\s+(range|cooktop)|all[\s-]electric\s+kitchen)/i;

// Masonry: structural brick/stone/block. "veneer" alone is cosmetic → concern-ish no.
// brownstone/fieldstone/limestone/bluestone/townhouse-block body words that end
// in "stone" fail the naive \b-stone-\b boundary; match them explicitly and
// bound to the right only ("brownstone" → structural; avoid "Stone Veneer").
const MASONRY_STRUCTURAL = /\b(brick|brownstone|fieldstone|limestone|bluestone|sandstone|stone|masonry|concrete\s*block|cinder\s*block|stucco over block)\b/i;
const MASONRY_VENEER_ONLY = /\b(brick|stone)\s+(veneer|front|accent)\b/i;
const MASONRY_FRAME_NEGATIVE = /^\s*(wood\s*frame|vinyl|metal|aluminum|hardiplank|fiber\s*cement)\s*$/i;

// Plumbing / build-quality CONCERNS (failing materials). Never a pass/fail filter.
const CONCERN_PATTERNS = [
  { key: 'polybutylene', label: 'Polybutylene supply pipe', re: /\b(polybutylene|poly-?b\b|\bPB\s+(pipe|piping|plumbing))\b/i },
  { key: 'kitec', label: 'Kitec plumbing', re: /\bkitec\b/i },
  { key: 'galvanized', label: 'Galvanized supply pipe', re: /\bgalvanized\b(?!.*\breplac)/i },
  { key: 'cpvc', label: 'CPVC supply lines', re: /\bcpvc\b/i },
  { key: 'fpe_panel', label: 'Federal Pacific (FPE) panel', re: /\bfederal\s+pacific\b|\bFPE\s+(panel|breaker)\b/i },
  { key: 'al_wiring', label: 'Aluminum branch wiring', re: /\baluminum\s+(branch\s+)?wiring\b/i },
  { key: 'cast_iron_stack', label: 'Cast-iron drain stack (age risk)', re: /\bcast[\s-]iron\s+(drain|stack|waste|sewer)\b/i },
  { key: 'electric_conv', label: 'Gas range converted to electric', re: GAS_CONVERSION_CONCERN },
];
// Positive mention wins over generic concern (e.g. "replaced all galvanized with copper").
const CONCERN_OVERRIDE = /\b(replaced|new|upgrade[ds]?)\b[^.]{0,40}?\b(copper|pex)\b/i;

// Build-quality extras (structured)
const CAST_IRON_HEAT = /\b(radiator|radiant|baseboard|steam)\b/i;
const STRUCTURAL_MASONRY_TOKENS = /brick|stone|masonry|stucco|concrete/i;

/* ------------------------------------------------------------- primitives */

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : []; }
function str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function rf(reso, key) { return reso ? (reso[key] ?? null) : null; }
function listHas(list, re) { return list.filter((s) => re.test(String(s))); }
function result(status, matched = [], source = 'none') { return { status, matched, source }; }

function structuredOrDesc({ okMatches, noMatches = [], descPositive, descNegative, description }) {
  if (okMatches.length) return result('yes', okMatches, 'structured');
  if (noMatches.length) return result('no', noMatches, 'structured');
  const neg = noMatches.concat(descNegative ? (String(description || '').match(descNegative) || [])[0] : null).filter(Boolean);
  if (descNegative && description && descNegative.test(description))
    return result('no', [String(description).match(descNegative)[0]], 'description');
  void neg;
  if (descPositive && description) {
    const m = String(description).match(descPositive);
    if (m) return result('yes', [m[0]], 'description');
  }
  return result('unknown');
}

/* ------------------------------------------------------- build-quality extra
 * Solid-masonry builds are strongly pre-1960 in most US markets — used as a
 * fallback signal when construction data is missing. */
function yearBuilt(reso) {
  return rf(reso, 'yearBuilt') || rf(reso, 'yearBuiltEffective') || null;
}

/* ================================================================= FILTERS
 * Semantics (all yes/no/unknown unless noted):
 *  gasRange            stoves: {'Gas Range','Gas Stove','Gas Cooktop','Gas Oven'} / desc gas mention
 *                      no:    ELECTRIC stoves, or definite electric/induction description
 *  masonry             yes:   constructionMaterials/structureType/architecturalStyle/exterior
 *                             contain brick|stone|masonry; yearBuilt<1940 fallback → yes
 *                      no:    only veneer tokens / explicit frame siding;  FR-4 style
 *  inUnitLaundry       yes:   laundryFeatures∋In Unit, interiorFeatures/appliances ∋ Washer/Dryer
 *  centralAC           yes:   cooling∋Central, interiorFeatures∋Central
 *                       no:    hasCooling===false or window/wall/none units only
 *  hardwood            yes:   flooring∋hardwood | desc hardwood floors
 *                       no:    ONLY carpet/lam/vinyl structured, or "laminate throughout"
 *  dishwasher          yes:   appliances∋Dishwasher
 *  attachedGarage      yes:   hasAttachedGarage===true or parkingFeatures∋Attached
 *                      no:    hasGarage===false
 *  radiatorHeat        yes:   heating∋radiator/radiant/baseboard/steam (cast-iron build signal)
 *  newConstruction     yes:   isNewConstruction or yearBuilt>=2020
 *
 * Concern layer (not pass/fail — surfaced as badges):
 *  detectConcerns()    failing plumbing/electrical/gas-conversion mentions
 */

export const FILTERS = [
  {
    id: 'gasRange', label: 'Gas range', icon: '🔥', defaultOn: true,
    evaluate({ resoFacts: rf2, description }) {
      const appliances = arr(rf(rf2, 'appliances'));
      const ok = listHas(appliances, /\bgas\s+(range|stove|cooktop|oven)\b|gas$/i)
        .filter((s) => /gas/i.test(s));
      const no = listHas(appliances, /\b(electric\s+(range|stove|cooktop|oven)|induction)\b/i);
      if (!ok.length && !no.length && description && GAS_CONVERSION_CONCERN.test(description))
        return result('unknown'); // let the concern badge carry it
      if (!ok.length && no.length) return result('no', no, 'structured');
      if (ok.length) return result('yes', ok, 'structured');
      if (description) {
        if (GAS_CONVERSION_CONCERN.test(description)) return result('unknown');
        if (ELECTRIC_DEFINITE.test(description))
          return result('no', [description.match(ELECTRIC_DEFINITE)[0]], 'description');
        if (GAS_POSITIVE.test(description))
          return result('yes', [description.match(GAS_POSITIVE)[0]], 'description');
      }
      return result('unknown');
    },
  },
  {
    id: 'masonry', label: 'Structural masonry', icon: '🧱', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const materials = [
        ...arr(rf(rf2, 'constructionMaterials')),
        ...arr(rf(rf2, 'structureType') ? [rf(rf2, 'structureType')] : []),
        ...(str(rf(rf2, 'architecturalStyle')) ? [str(rf(rf2, 'architecturalStyle'))] : []),
        ...(str(rf(rf2, 'style')) ? [str(rf(rf2, 'style'))] : []),
        ...arr(rf(rf2, 'exteriorFeatures')),
      ].flat();
      const structural = listHas(materials, MASONRY_STRUCTURAL)
        .filter((s) => !MASONRY_VENEER_ONLY.test(s) && !MASONRY_FRAME_NEGATIVE.test(s));
      if (structural.length) return result('yes', structural, 'structured');
      const veneers = listHas(materials, MASONRY_VENEER_ONLY);
      const frames = listHas(materials, MASONRY_FRAME_NEGATIVE);
      if (!structural.length && (veneers.length || frames.length))
        return result('no', veneers.concat(frames), 'structured');
      // era fallback: pre-1940 construction is overwhelmingly masonry or heavy timber
      const yb = yearBuilt(rf2);
      if (yb && yb < 1940) return result('yes', [`built ${yb}`], 'structured');
      if (description) {
        const m = String(description).match(MASONRY_STRUCTURAL);
        if (m && !/\bveneer\b/i.test(description)) return result('yes', [m[0]], 'description');
      }
      return result('unknown');
    },
  },
  {
    id: 'inUnitLaundry', label: 'In-unit laundry', icon: '🧺', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const buckets = [
        ...arr(rf(rf2, 'laundryFeatures')),
        ...arr(rf(rf2, 'appliances')),
        ...arr(rf(rf2, 'interiorFeatures')),
      ];
      const ok = listHas(buckets, /(in[\s-]?unit|washer|dryer|laundry\s+in\s+(unit|apartment)|hookup)/i);
      const no = listHas(buckets, /(shared|common|coin|on[\s-]?site\s+laundry|laundry\s+room|in\s+building)/i)
        .filter((s) => !/in[\s-]?unit|hookup/i.test(s));
      return structuredOrDesc({
        okMatches: ok, noMatches: no, description,
        descNegative: /shared\s+((in[\s-]?building\s+)?laundry|laundry\s+room)|coin[\s-]?op/i,
        descPositive: /(in[\s-]?unit\s+(laundry|washer)|washer\s*(and|\/|&)\s*dryer\s+in\s+unit|w\/d\s+in\s+unit|laundry\s+in\s+unit|washer\/dryer)/i,
      });
    },
  },
  {
    id: 'centralAC', label: 'Central A/C', icon: '❄️', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const cooling = arr(rf(rf2, 'cooling'));
      const ok = listHas([...cooling, ...arr(rf(rf2, 'interiorFeatures'))], /\bcentral\b/i);
      const neg = listHas(cooling, /(window|wall|mini[\s-]?split|none|evaporative)/i);
      if (ok.length) return result('yes', ok, 'structured');
      if (rf(rf2, 'hasCooling') === false) return result('no', ['hasCooling: false'], 'structured');
      if (neg.length) return result('no', neg, 'structured');
      return structuredOrDesc({
        okMatches: [], description,
        descPositive: /\bcentral\s+(air|a\/c|ac)\b/i,
      });
    },
  },
  {
    id: 'hardwood', label: 'Hardwood floors', icon: '🪵', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const flooring = arr(rf(rf2, 'flooring'));
      const ok = listHas(flooring, /hardwood|hard\s*wood/i);
      const onlySoft = flooring.length && !ok.length &&
        flooring.every((f) => /(carpet|laminate|vinyl|linoleum|lvp|lvt|tile|concrete)/i.test(f));
      if (ok.length) return result('yes', ok, 'structured');
      if (onlySoft) return result('no', flooring, 'structured');
      return structuredOrDesc({
        okMatches: [], description,
        descNegative: /(carpet|laminate|luxury\s+vinyl|lvp)\s+(throughout|floors?\b[^.]{0,20}(everywhere|all\s+rooms))/i,
        descPositive: /hardwood\s+floors?/i,
      });
    },
  },
  {
    id: 'dishwasher', label: 'Dishwasher', icon: '🍽️', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const ok = listHas(arr(rf(rf2, 'appliances')), /\bdishwasher\b/i);
      return structuredOrDesc({
        okMatches: ok, description,
        descPositive: /\bdishwasher\b/i,
      });
    },
  },
  {
    id: 'attachedGarage', label: 'Attached garage', icon: '🚗', defaultOn: false,
    evaluate({ resoFacts: rf2 }) {
      if (rf(rf2, 'hasAttachedGarage') === true) return result('yes', ['attached'], 'structured');
      const ok = listHas(arr(rf(rf2, 'parkingFeatures')), /attached\s+garage/i);
      if (ok.length) return result('yes', ok, 'structured');
      if (rf(rf2, 'hasGarage') === false) return result('no', ['hasGarage: false'], 'structured');
      return result('unknown');
    },
  },
  {
    id: 'radiatorHeat', label: 'Radiant/radiator heat', icon: '♨️', defaultOn: false,
    evaluate({ resoFacts: rf2, description }) {
      const ok = listHas(arr(rf(rf2, 'heating')), CAST_IRON_HEAT);
      return structuredOrDesc({
        okMatches: ok, description,
        descPositive: /\b(cast[\s-]iron\s+radiators?|radiant\s+(floor\s+)?heat|radiators)\b/i,
      });
    },
  },
  {
    id: 'newConstruction', label: 'New construction', icon: '🏗️', defaultOn: false,
    evaluate({ resoFacts: rf2 }) {
      if (rf(rf2, 'isNewConstruction') === true) return result('yes', ['new construction'], 'structured');
      const yb = yearBuilt(rf2);
      if (yb && yb >= 2020) return result('yes', [`built ${yb}`], 'structured');
      if (rf(rf2, 'isNewConstruction') === false) return result('no', ['not new'], 'structured');
      return result('unknown');
    },
  },
];

export const FILTER_MAP = Object.fromEntries(FILTERS.map((f) => [f.id, f]));

/** Concern layer — failing materials & red flags. Returns [{key,label,matched}].
 *  Explicitly NOT a pass/fail filter: these are rare mentions, mostly in
 *  for-sale listings with disclosure language. */
export function detectConcerns({ description }) {
  if (!description) return [];
  const out = [];
  for (const c of CONCERN_PATTERNS) {
    const m = String(description).match(c.re);
    if (m) {
      if (CONCERN_OVERRIDE.test(description)) continue; // "replaced with copper" wins
      out.push({ key: c.key, label: c.label, matched: m[0].trim() });
    }
  }
  return out;
}

/* ----------------------------------------------- adapter: Zillow page JSON */

/** Build our listing input from Zillow's gdpClientCache property object. */
export function fromZillowProperty(prop) {
  if (!prop) return { resoFacts: null, description: null };
  return {
    resoFacts: prop.resoFacts || null,
    description: prop.description || prop.homeDescription || null,
  };
}

export function evaluateAll(listing, enabledIds) {
  const out = {};
  for (const f of FILTERS) {
    if (enabledIds && !enabledIds.includes(f.id)) continue;
    out[f.id] = f.evaluate(listing);
  }
  return out;
}
