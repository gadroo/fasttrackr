const CLEAR_FIELD_SENTINEL = "__CLEAR_FIELD__";
const CLEAR_FIELD_DISPLAY = "[clear value]";

export function encodeProposalValue(value: string | null): string {
  return value === null ? CLEAR_FIELD_SENTINEL : value;
}

export function decodeProposalValue(value: string): string | null {
  return value === CLEAR_FIELD_SENTINEL ? null : value;
}

export function decodeProposalValueForDisplay(value: string): string {
  return value === CLEAR_FIELD_SENTINEL ? CLEAR_FIELD_DISPLAY : value;
}
