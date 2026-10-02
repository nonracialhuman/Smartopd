/** Shared simulator flag, kept apart from the simulator so projections don't import its logic. */
export const simulatorState = { enabled: false };

/** Doctors with a live staff socket; the simulator leaves them alone. */
export const connectedDoctors = new Map<string, number>();
