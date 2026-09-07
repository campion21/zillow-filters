import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAll, detectConcerns, FILTER_MAP, fromZillowProperty } from '../shared/detector.js';

const NO_DESC = { resoFacts: null, description: null };

/* ---------- gasRange ---------- */

test('gas: appliances contains Gas Range → yes', () => {
  const l = { ...NO_DESC, resoFacts: { appliances: ['Dryer', 'Gas Range', 'Refrigerator'] } };
  const r = FILTER_MAP.gasRange.evaluate(l);
  assert.equal(r.status, 'yes');
  assert.equal(r.source, 'structured');
  assert.deepEqual(r.matched, ['Gas Range']);
});

test('gas: Gas Cooktop only → yes', () => {
  const r = FILTER_MAP.gasRange.evaluate({ ...NO_DESC, resoFacts: { appliances: ['Gas Cooktop'] } });
  assert.equal(r.status, 'yes');
});

test('gas: Gas Stove spelling → yes', () => {
  const r = FILTER_MAP.gasRange.evaluate({ ...NO_DESC, resoFacts: { appliances: ['Gas Stove', 'Dishwasher'] } });
  assert.equal(r.status, 'yes');
});

test('gas: Electric Range only → no', () => {
  const r = FILTER_MAP.gasRange.evaluate({ ...NO_DESC, resoFacts: { appliances: ['Electric Range', 'Dishwasher'] } });
  assert.equal(r.status, 'no');
  assert.deepEqual(r.matched, ['Electric Range']);
});

test('gas: electric + gas both present (dual fuel range listing) → yes wins', () => {
  const r = FILTER_MAP.gasRange.evaluate({
    ...NO_DESC, resoFacts: { appliances: ['Electric Oven', 'Gas Cooktop'] },
  });
  assert.equal(r.status, 'yes');
});

test('gas: description "gas stove" with empty appliances → yes', () => {
  const r = FILTER_MAP.gasRange.evaluate({ resoFacts: { appliances: [] }, description: "Chef's kitchen with gas stove and quartz counters." });
  assert.equal(r.status, 'yes');
  assert.equal(r.source, 'description');
});

test('gas: "converted gas range to electric" → concern fires, verdict not yes', () => {
  const r = FILTER_MAP.gasRange.evaluate({ resoFacts: null, description: 'Owner converted the gas range to electric last year.' });
  assert.notEqual(r.status, 'yes');
  const concerns = detectConcerns({ description: 'Owner converted the gas range to electric last year.' });
  assert.ok(concerns.some((c) => c.key === 'electric_conv'));
});

test('gas: "no gas service" does NOT crash; electric definite → no', () => {
  const r = FILTER_MAP.gasRange.evaluate({ resoFacts: null, description: 'No gas in unit. Electric range and electric heat.' });
  assert.equal(r.status, 'no');
});

test('gas: all-electric kitchen → no', () => {
  const r = FILTER_MAP.gasRange.evaluate({ resoFacts: null, description: 'All-electric kitchen with induction range.' });
  assert.equal(r.status, 'no');
});

test('gas: nothing anywhere → unknown', () => {
  const r = FILTER_MAP.gasRange.evaluate(NO_DESC);
  assert.equal(r.status, 'unknown');
});

test('gas: bare "gas line" mention is not definitive (avoid false positive)', () => {
  const r = FILTER_MAP.gasRange.evaluate({ resoFacts: null, description: 'Building has gas service available.' });
  assert.notEqual(r.status, 'yes');
});

/* ---------- masonry ---------- */

test('masonry: Brick in constructionMaterials → yes', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { constructionMaterials: ['Brick'] } });
  assert.equal(r.status, 'yes');
});

test('masonry: architecturalStyle Brownstone → yes', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { architecturalStyle: 'Brownstone' } });
  assert.equal(r.status, 'yes');
});

test('masonry: Brick Veneer only → no', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { constructionMaterials: ['Brick Veneer', 'Wood Frame'] } });
  assert.equal(r.status, 'no');
});

test('masonry: Vinyl siding only → no', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { exteriorFeatures: ['Vinyl'] } });
  assert.equal(r.status, 'no');
});

test('masonry: built 1925 with no materials → yes (era fallback)', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { yearBuilt: 1925 } });
  assert.equal(r.status, 'yes');
  assert.equal(r.matched[0], 'built 1925');
});

test('masonry: modern with no data → unknown', () => {
  const r = FILTER_MAP.masonry.evaluate({ ...NO_DESC, resoFacts: { yearBuilt: 1998 } });
  assert.equal(r.status, 'unknown');
});

test('masonry: description "classic brick colonial" → yes', () => {
  const r = FILTER_MAP.masonry.evaluate({ resoFacts: null, description: 'Classic brick colonial on quiet street.' });
  assert.equal(r.status, 'yes');
});

/* ---------- laundry / AC / floors / dishwasher / garage ---------- */

test('laundry: In Unit feature → yes', () => {
  const r = FILTER_MAP.inUnitLaundry.evaluate({ ...NO_DESC, resoFacts: { laundryFeatures: ['In Unit'] } });
  assert.equal(r.status, 'yes');
});

test('laundry: hookups count as yes', () => {
  const r = FILTER_MAP.inUnitLaundry.evaluate({ ...NO_DESC, resoFacts: { laundryFeatures: ['Washer Hookup', 'Dryer Hookup'] } });
  assert.equal(r.status, 'yes');
});

test('laundry: shared laundry in desc → no', () => {
  const r = FILTER_MAP.inUnitLaundry.evaluate({ resoFacts: null, description: 'Shared laundry room in basement.' });
  assert.equal(r.status, 'no');
});

test('laundry: unknown when absent', () => {
  assert.equal(FILTER_MAP.inUnitLaundry.evaluate(NO_DESC).status, 'unknown');
});

test('AC: Central Air → yes; window only → no; hasCooling false → no', () => {
  assert.equal(FILTER_MAP.centralAC.evaluate({ ...NO_DESC, resoFacts: { cooling: ['Central Air'] } }).status, 'yes');
  assert.equal(FILTER_MAP.centralAC.evaluate({ ...NO_DESC, resoFacts: { cooling: ['Window Unit(s)'] } }).status, 'no');
  assert.equal(FILTER_MAP.centralAC.evaluate({ ...NO_DESC, resoFacts: { hasCooling: false } }).status, 'no');
});

test('AC: mini-split counts as no, per filter semantics', () => {
  assert.equal(FILTER_MAP.centralAC.evaluate({ ...NO_DESC, resoFacts: { cooling: ['Mini Split'] } }).status, 'no');
});

test('floors: Hardwood structured → yes', () => {
  assert.equal(FILTER_MAP.hardwood.evaluate({ ...NO_DESC, resoFacts: { flooring: ['Hardwood', 'Tile'] } }).status, 'yes');
});

test('floors: only carpet+laminate → no', () => {
  assert.equal(FILTER_MAP.hardwood.evaluate({ ...NO_DESC, resoFacts: { flooring: ['Carpet', 'Laminate'] } }).status, 'no');
});

test('floors: "hardwood floors" in desc → yes', () => {
  assert.equal(FILTER_MAP.hardwood.evaluate({ resoFacts: null, description: 'Original hardwood floors throughout.' }).status, 'yes');
});

test('dishwasher: structured yes', () => {
  assert.equal(FILTER_MAP.dishwasher.evaluate({ ...NO_DESC, resoFacts: { appliances: ['Dishwasher'] } }).status, 'yes');
});

test('garage: hasAttachedGarage true → yes; hasGarage false → no', () => {
  assert.equal(FILTER_MAP.attachedGarage.evaluate({ ...NO_DESC, resoFacts: { hasAttachedGarage: true } }).status, 'yes');
  assert.equal(FILTER_MAP.attachedGarage.evaluate({ ...NO_DESC, resoFacts: { hasGarage: false, parkingFeatures: [] } }).status, 'no');
});

test('radiator heat: Radiator heating → yes', () => {
  assert.equal(FILTER_MAP.radiatorHeat.evaluate({ ...NO_DESC, resoFacts: { heating: ['Radiator'] } }).status, 'yes');
});

test('newConstruction: built 2023 → yes', () => {
  assert.equal(FILTER_MAP.newConstruction.evaluate({ ...NO_DESC, resoFacts: { yearBuilt: 2023 } }).status, 'yes');
});

/* ---------- concerns ---------- */

test('concern: polybutylene detected', () => {
  const c = detectConcerns({ description: 'Plumbing updated in 2015, no polybutylene remains.' });
  // mentions word even in benign context → flagged; acceptable for a concern badge
  // (user reads the snippet; we keep recall high for failing materials)
  assert.ok(c.some((x) => x.key === 'polybutylene'));
});

test('concern: "replaced galvanized with copper" → NO galvanized concern', () => {
  const c = detectConcerns({ description: 'All galvanized lines replaced with copper in 2019.' });
  assert.ok(!c.some((x) => x.key === 'galvanized'));
});

test('concern: bare galvanized mention flags', () => {
  const c = detectConcerns({ description: 'Original galvanized plumbing throughout.' });
  assert.ok(c.some((x) => x.key === 'galvanized'));
});

test('concern: kitec, cpvc, FPE, aluminum wiring, cast iron stack', () => {
  const d = 'Kitec manifold, CPVC lines, Federal Pacific panel, aluminum wiring upstairs, cast-iron drain stack.';
  const keys = detectConcerns({ description: d }).map((c) => c.key);
  for (const k of ['kitec', 'cpvc', 'fpe_panel', 'al_wiring', 'cast_iron_stack']) assert.ok(keys.includes(k), k);
});

test('concern: clean descrption → empty', () => {
  assert.deepEqual(detectConcerns({ description: 'Pex plumbing, copper supply, updated 200A panel.' }), []);
});

/* ---------- integration helpers ---------- */

test('evaluateAll only runs enabled filters', () => {
  const l = { resoFacts: { appliances: ['Gas Range'], flooring: ['Hardwood'] }, description: null };
  const r = evaluateAll(l, ['gasRange']);
  assert.deepEqual(Object.keys(r), ['gasRange']);
});

test('fromZillowProperty maps resoFacts + description variants', () => {
  const p = { resoFacts: { appliances: ['Gas Range'] }, description: 'd' };
  const l = fromZillowProperty(p);
  assert.equal(l.resoFacts.appliances[0], 'Gas Range');
  assert.equal(l.description, 'd');
  assert.equal(fromZillowProperty({ homeDescription: 'x' }).description, 'x');
  assert.deepEqual(fromZillowProperty(null), { resoFacts: null, description: null });
});
