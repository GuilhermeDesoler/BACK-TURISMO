/**
 * Horários fixos disponíveis para agendamento.
 * Pode ser movido para Firestore settings futuramente.
 */
export const TIME_SLOTS = ['08:00', '10:00', '14:00', '16:00'] as const;

export type TimeSlot = (typeof TIME_SLOTS)[number];
