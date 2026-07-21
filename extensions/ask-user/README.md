# Ask user

Registers `ask_user`, a structured interactive question tool.

Each call asks one question with 2–5 options and optional descriptions. A free-form custom-answer option is always added. Escape dismisses the question without granting permission to assume an answer.

In print or JSON mode, where interactive UI is unavailable, the tool tells the model to ask in plain text.
