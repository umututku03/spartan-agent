/**
 * Amount fields for a swap action result. The risk layer may clamp the requested amount, and the
 * planner reads the structured result, not the reply text, so the result must carry the executed
 * amount and say whether it differs from the request.
 */
export function executedAmountFields(requested: string | number, executed: string | number) {
  return {
    amount: executed,
    requestedAmount: requested,
    clamped: Number(executed) !== Number(requested),
  };
}
