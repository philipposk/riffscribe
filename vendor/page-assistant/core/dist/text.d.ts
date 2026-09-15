/**
 * Collapse to one trimmed line of at most `max` characters. For host- or user-supplied
 * text placed into the system prompt or llm.txt, where a newline would start a new line
 * of instructions.
 */
export declare function oneLine(value: unknown, max: number): string;
