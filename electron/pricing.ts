// Giá tham khảo OpenAI, USD / 1 triệu token (cập nhật thủ công khi giá đổi).
// Nguồn: https://openai.com/api/pricing
// Chỉ các model đang dùng trong app (dropdown Cài đặt).
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-4.1': { input: 2, output: 8 },
};

const DEFAULT_PRICE = { input: 0.4, output: 1.6 }; // fallback ~ giá gpt-4.1-mini

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
  // Khớp chính xác trước; nếu không có thì lấy prefix DÀI NHẤT
  // (tránh "gpt-4o-mini" bị khớp nhầm sang "gpt-4o").
  const price =
    PRICING[model] ??
    Object.keys(PRICING)
      .filter((k) => model.startsWith(k))
      .sort((a, b) => b.length - a.length)
      .map((k) => PRICING[k])[0] ??
    DEFAULT_PRICE;
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
