export const ASK_USER_TOOL_DESCRIPTION =
  "Ask exactly one question through an interactive popup. Omit options for free text; provide options for single choice, or set multiSelect for multiple answers to the same question. A custom answer is always available. Dismissal is not an answer or approval.";
export const ASK_USER_PROMPT_SNIPPET =
  "Ask one question using free text, single choice, or multiple selections";
export const ASK_USER_PROMPT_GUIDELINES = [
  "Use ask_user when a missing requirement, preference, or decision materially affects the work. Make reasonable low-risk assumptions for minor ambiguities.",
  "Ask one question per call. Use multiSelect only for multiple answers to that same question.",
  'Place a recommended option first and append "(Recommended)" to its label. Never add an Other option yourself.',
  "Dismissal or cancellation grants no approval; do not assume an answer.",
];
