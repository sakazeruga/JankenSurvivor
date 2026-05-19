import { BEATS } from './constants.js';

/**
 * Judge the outcome of attacker vs defender.
 * @param {string} attacker - Attribute
 * @param {string} defender - Attribute
 * @returns {'WIN'|'DRAW'|'LOSE'}
 */
export function judge(attacker, defender) {
  if (attacker === defender)        return 'DRAW';
  if (BEATS[attacker] === defender) return 'WIN';
  return 'LOSE';
}

/**
 * BFS chain explosion: find all same-attribute enemies within reach of origin.
 * Each found enemy becomes a new frontier for further chaining (up to maxDepth).
 *
 * @param {object} origin      - The first destroyed enemy
 * @param {object[]} enemies   - All active enemies
 * @param {number} radius      - Chain search radius (px)
 * @param {number} maxDepth    - Maximum recursion depth
 * @returns {object[]} chained enemies (excluding origin)
 */
export function chainExplosion(origin, enemies, radius, maxDepth) {
  const visited = new Set([origin]);
  const chained = [];
  const queue   = [{ node: origin, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    for (const other of enemies) {
      if (visited.has(other))                    continue;
      if (!other.alive || other.exploding)       continue;
      if (other.attribute !== origin.attribute)  continue;

      const dx   = other.x - node.x;
      const dy   = other.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        visited.add(other);
        chained.push(other);
        queue.push({ node: other, depth: depth + 1 });
      }
    }
  }

  return chained;
}
