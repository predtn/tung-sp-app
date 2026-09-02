// Giá tham khảo OpenAI, USD / 1 triệu token (cập nhật thủ công khi giá đổi).
// Nguồn: https://openai.com/api/pricing
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
};

const DEFAULT_PRICE = { input: 2.5, output: 10 }; // fallback ~ giá gpt-4o

export interface UsageCost {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedUsd: number;
}

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): UsageCost {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  const price = key ? PRICING[key] : DEFAULT_PRICE;
  const estimatedUsd =
    (promptTokens / 1_000_000) * price.input +
    (completionTokens / 1_000_000) * price.output;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedUsd,
  };
}
