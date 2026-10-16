// Glicko-2 implementation
// Reference: http://www.glicko.net/glicko/glicko2.pdf

const TAU = 0.5;
const EPSILON = 0.000001;
const SCALE = 173.7178;

interface Rating { rating: number; rd: number; vol: number; }

function toGlicko2(r: Rating) {
  return {
    mu: (r.rating - 1500) / SCALE,
    phi: r.rd / SCALE,
    sigma: r.vol,
  };
}

function fromGlicko2(g: any): Rating {
  return {
    rating: g.mu * SCALE + 1500,
    rd: g.phi * SCALE,
    vol: g.sigma,
  };
}

function g(phi: number) {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu: number, mu_j: number, phi_j: number) {
  return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

export function updateRating(
  player: Rating,
  results: { rating: number; rd: number; score: number }[]  // score: 1=win, 0=loss, 0.5=draw
): Rating {
  if (results.length === 0) {
    // No matches: RD increases (uncertainty grows)
    const newRd = Math.min(Math.sqrt(player.rd ** 2 + player.vol ** 2), 350);
    return { ...player, rd: newRd };
  }

  const p = toGlicko2(player);
  const opponents = results.map(r => ({ ...toGlicko2({ rating: r.rating, rd: r.rd, vol: 0.06 }), score: r.score }));

  let v = 0;
  let deltaSum = 0;

  for (const opp of opponents) {
    const gPhi = g(opp.phi);
    const e = E(p.mu, opp.mu, opp.phi);
    v += gPhi * gPhi * e * (1 - e);
    deltaSum += gPhi * (opp.score - e);
  }

  v = 1 / v;
  const delta = v * deltaSum;

  // Iterative volatility computation
  const a = Math.log(p.sigma * p.sigma);
  let A = a;
  let B: number;
  if (delta * delta > p.phi * p.phi + v) {
    B = Math.log(delta * delta - p.phi * p.phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU, a, delta, p.phi, v) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A, a, delta, p.phi, v);
  let fB = f(B, a, delta, p.phi, v);

  while (Math.abs(B - A) > EPSILON) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C, a, delta, p.phi, v);
    if (fC * fB <= 0) { A = B; fA = fB; }
    else { fA = fA / 2; }
    B = C; fB = fC;
  }

  const newSigma = Math.exp(A / 2);
  const newPhiStar = Math.sqrt(p.phi ** 2 + newSigma ** 2);
  const newPhi = 1 / Math.sqrt(1 / (newPhiStar ** 2) + 1 / v);
  const newMu = p.mu + newPhi ** 2 * deltaSum;

  return fromGlicko2({ mu: newMu, phi: newPhi, sigma: newSigma });
}

function f(x: number, a: number, delta: number, phi: number, v: number) {
  const ex = Math.exp(x);
  const num = ex * (delta ** 2 - phi ** 2 - v - ex);
  const den = 2 * (phi ** 2 + v + ex) ** 2;
  return num / den - (x - a) / (TAU ** 2);
}

export function tierFromRating(rating: number): string {
  if (rating >= 2800) return 'Master';
  if (rating >= 2400) return 'Diamond';
  if (rating >= 2000) return 'Platinum';
  if (rating >= 1500) return 'Gold';
  if (rating >= 1000) return 'Silver';
  return 'Bronze';
}