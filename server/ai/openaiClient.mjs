const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_TIMEOUT_MS = 12000;

function resolveApiKey() {
  return String(process.env.OPENAI_API_KEY ?? '').trim();
}

function resolveModel(model) {
  return String(model ?? process.env.OPENAI_MODEL ?? 'gpt-5.4-mini').trim() || 'gpt-5.4-mini';
}

function withTimeout(timeoutMs = OPENAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
    },
  };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

export function isOpenAiConfigured() {
  return Boolean(resolveApiKey());
}

export async function createStructuredOpenAiResponse({
  input,
  instructions,
  jsonSchema,
  model,
  maxOutputTokens = 1200,
}) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const timeout = withTimeout();

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: timeout.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolveModel(model),
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: jsonSchema.name,
            strict: true,
            schema: jsonSchema.schema,
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `OpenAI request failed with ${response.status}.`);
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error('OpenAI response did not include output text.');
    }

    return {
      model: payload?.model ?? resolveModel(model),
      parsed: JSON.parse(outputText),
      raw: payload,
    };
  } finally {
    timeout.cleanup();
  }
}
