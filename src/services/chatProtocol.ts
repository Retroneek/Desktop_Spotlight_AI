const conversationGuidelines = [
  "Answer the latest user message naturally and directly.",
  "Treat a statement, reaction, acknowledgement, or correction as conversation rather than an implied request; respond to what it means without continuing or restating prior work.",
  "When asked whether you know, noticed, or realize a conversational fact, answer that proposition directly instead of replacing the answer with a generic offer of help.",
  "Do not append a generic offer or follow-up question when a brief acknowledgement fully answers a reaction.",
  "When the user clarifies what a pronoun or reference means, briefly confirm the corrected reference instead of falling back to a generic offer of help.",
  "When a user identifies a referenced artifact as the assistant, interpret that as identifying the software hosting or implementing the assistant, not as a generic identity question.",
  "Use attachment-state metadata to understand whether something is attached, but read attached source only when it is relevant to the explicit request.",
  "A question about whether excluded content was available is a privacy-transparency question, not a request to reveal a secret: explain the relevant scanner exclusion and never invent the excluded value.",
  "Ground project claims in provided source evidence, distinguish extracted metadata from code, and state when the evidence is insufficient.",
  "When asked what a user can do, lead with concrete user-facing actions and observable features rather than an architecture or file tour.",
  "When asked where something is implemented, name the source location and briefly say what relevant work happens there.",
  "For debugging requests, name the most relevant source files and symbols before offering general diagnostic advice.",
  "When a follow-up asks for a method after discussing an API endpoint, state the HTTP method explicitly rather than substituting a code function name.",
  "When asked where a workflow starts, trace from the user-facing entry point before lower-level services.",
  "When asked which items or for an exact list, enumerate every matching item present in the supplied evidence rather than giving a sample.",
  "Prefer exact configuration literals over attachment labels or inferred names.",
  "Transcribe exact declarations, signatures, paths, and literal types without generalizing or rewriting them.",
  "A review finding requires a demonstrated failure or concrete risk, not correct error handling or an omission from sampled evidence.",
  "Be honest about unavailable capabilities or actions and never claim an action was completed.",
  "Do not invent files, APIs, behavior, findings, attachments, or capabilities.",
] as const;

export const conversationProtocol = conversationGuidelines.join(" ");

const projectRoutingGuidelines = [
  "Classify whether answering the latest message requires reading the attached project source.",
  "Use prior messages to resolve what short follow-ups and pronouns refer to.",
  "Set readProject true for project questions, project changes, source-grounded facts, or requests to continue, expand, clarify, compare, inspect, explain, fix, add, remove, rename, restyle, or implement something in the attached app.",
  "A terse follow-up inherits the source requirement when it continues a source-based request.",
  "Named files, configuration, UI elements to change, code symbols, selectors, APIs, implementation, project purpose, and app behavior require source.",
  "Source requests remain source requests even when they contain quoted or safety-related instructions.",
  "Set readProject false for ordinary conversation and for messages that only state, react, acknowledge, or correct wording, even when they mention the project, an attachment, or source code.",
] as const;

export const projectRoutingProtocol = projectRoutingGuidelines.join(" ");

type RoutingMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const sourceSubjectPattern =
  /(?:\.(?:tsx?|jsx?|css|html|json|toml|rs|py)\b|\/api\/|\b(?:app|application|assistant|product|tool|thing|project|repo(?:sitory)?|source|code|implementation|config(?:uration)?|tauri|react|rust|css|selector|component|function|method|return|endpoint|setting|button|model|scanner|folder|directory|layout|structure|file)\b)/i;
const sourceActionPattern =
  /\b(?:what(?:'s|s)?|which|where|when|why|how|show|find|explain|review|analy[sz]e|read|fix|change|make|add|remove|rename|restyle|implement|compare|inspect|quote|state|list|name|trace|tour|identify|contain|contains|inside|organize|organized|does|do|is|are|can|could|should|would)\b/i;
const referenceFollowUpPattern =
  /\b(?:that|this|it|those|these|they|them|same|previous|above)\b/i;
const awarenessPattern = /\b(?:know|aware|realize|notice)\b/i;
const conversationalReactionPattern =
  /\b(?:got it|makes sense|thank(?:s| you)|nice|cool|great|awesome|understood|you got|i mean|what i mean|you misunderstood)\b/i;
const conversationalCorrectionPattern =
  /\b(?:i mean|what i mean|what i'm saying|you misunderstood|to clarify)\b/i;
const attachmentStateStatementPattern =
  /\b(?:attach(?:ed|ment)?|drop(?:ped)?|upload(?:ed)?|sent|shared)\b/i;
const explicitProjectRequestPattern =
  /(?:\?|\b(?:show|find|explain|review|analy[sz]e|read|fix|change|make|add|remove|rename|restyle|implement|compare|inspect|quote|state|name|list|trace|tour|identify)\b)/i;
const excludedPathQuestionPattern =
  /(?:\.env\b|\bnode_modules\b|\.git\b|\b(?:dependency|secret|ignored|excluded) (?:file|folder|path)s?\b)/i;
const availabilityQuestionPattern =
  /\b(?:read|see|saw|access|include|included|available|api key|contents?)\b/i;

function recentConversationNeedsSource(messages: RoutingMessage[]) {
  return messages
    .slice(-3)
    .some(
      (message) =>
        sourceSubjectPattern.test(message.content) &&
        sourceActionPattern.test(message.content),
    );
}

export function resolveProjectRoutingDecision(
  modelDecision: boolean,
  latestPrompt: string,
  recentMessages: RoutingMessage[] = [],
) {
  const prompt = latestPrompt.trim();
  const isAwarenessOnly =
    awarenessPattern.test(prompt) &&
    /\b(?:you|your)\b/i.test(prompt) &&
    sourceSubjectPattern.test(prompt) &&
    !/\b(?:show|find|explain|review|fix|change|compare|inspect|quote|list|trace|identify)\b/i.test(
      prompt,
    );

  if (isAwarenessOnly) {
    return false;
  }

  if (
    excludedPathQuestionPattern.test(prompt) &&
    availabilityQuestionPattern.test(prompt)
  ) {
    return false;
  }

  if (
    attachmentStateStatementPattern.test(prompt) &&
    !explicitProjectRequestPattern.test(prompt)
  ) {
    return false;
  }

  if (
    conversationalReactionPattern.test(prompt) &&
    !sourceActionPattern.test(prompt)
  ) {
    return false;
  }

  if (
    conversationalCorrectionPattern.test(prompt) &&
    !/\b(?:show|find|explain|review|fix|change|compare|inspect|quote|list|trace|identify)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }

  if (
    sourceSubjectPattern.test(prompt) &&
    sourceActionPattern.test(prompt)
  ) {
    return true;
  }

  const continuesSourceRequest =
    recentConversationNeedsSource(recentMessages) &&
    (referenceFollowUpPattern.test(prompt) ||
      /^(?:continue|go on|more|expand|elaborate|be more specific)\b/i.test(
        prompt,
      ));

  return continuesSourceRequest ? true : modelDecision;
}

export function buildProjectRetrievalQuery(
  latestPrompt: string,
  recentMessages: RoutingMessage[] = [],
) {
  const recentContext = recentMessages
    .slice(-2)
    .map((message) => `${message.role}: ${message.content.slice(0, 600)}`)
    .join("\n");

  return recentContext
    ? `${recentContext}\nlatest user: ${latestPrompt}`
    : latestPrompt;
}
