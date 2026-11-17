// Community building planning is read-only: return a proposed project, never
// spend resources, add structures or start construction. Execution remains in
// construction.js and may reject the plan if resources or sites have changed.
import { communityNeedsAdditionalPen } from '../ecology/herd.js';

export function nextCommunityStructure(w, community, size, structures) {
    if (structures.some(s => !s.complete)) return { type: 'ongoing', woodCost: 0, stoneCost: 0, foodCost: 0 };
    if (community.isKingdomGroup && size >= 6 && !structures.some(s => s.type === 'roça')) {
      return { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, seedMass: 8, required: 34 };
    }
    if (!structures.some(s => s.type === 'abrigo')) return { type: 'abrigo', woodCost: 18, stoneCost: 8, foodCost: 0, required: 28 };
    if (size >= 6 && !structures.some(s => s.type === 'roça')) return { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, seedMass: 8, required: 34 };
    if (size >= 6 && !structures.some(s => s.type === 'curral')) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    if (communityNeedsAdditionalPen(w, community.id)) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    if (!structures.some(s => s.type === 'posto de coleta')) return { type: 'posto de coleta', woodCost: 20, stoneCost: 12, foodCost: 1, required: 36 };
    if (size >= 12 && !structures.some(s => s.type === 'acampamento')) return { type: 'acampamento', woodCost: 24, stoneCost: 16, foodCost: 1, required: 44 };
    return null;
  }

