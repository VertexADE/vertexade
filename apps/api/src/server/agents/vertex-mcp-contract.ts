export const vertexMcpServerId = 'vertexade:subagents'
export const vertexMcpServerName = 'vertexade-subagents'

export const vertexFormFieldTypes = ['text', 'textarea', 'select', 'checkbox', 'number', 'date', 'email', 'url', 'password'] as const

export type VertexFormFieldType = (typeof vertexFormFieldTypes)[number]

export const vertexFormInstructions =
  'Vertex Form is available in every collaboration mode, including Default mode. You MUST use the form tool instead of writing questions in chat whenever you need two or more user answers, or when choices, checklists, dates, numbers, URLs, email addresses, multiline text, or secrets make a structured field clearer. Choose the narrowest correct field type for every question; use select for one choice, checkbox for multiple choices, textarea for long text, and the dedicated number, date, email, URL, or password type when applicable. Ask only for information that cannot be inferred safely, keep the form concise, and continue normally when the user cancels it or sends a chat message instead.'

export const vertexFormPromptInstruction = `<vertexade_form>
Vertex Form is available through the built-in form tool. You MUST use it instead of asking in prose whenever you need two or more answers from the user. Also prefer it for a single answer when a select, checkbox, number, date, email, URL, password, or multiline field is clearer than chat. Choose the narrowest correct input type for each field. Do not ask questions whose answers can be inferred safely.
</vertexade_form>`
