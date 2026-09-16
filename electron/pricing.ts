// Giá tham khảo OpenAI, USD / 1 triệu token (cập nhật thủ công khi giá đổi).
// Nguồn: https://openai.com/api/pricing
// gpt-4.1-mini đã bỏ khỏi dropdown Cài đặt nhưng giữ giá ở đây để tính đúng
// chi phí các lượt quét CŨ (trước khi bỏ) vẫn còn trong lịch sử/cache.
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-4.1': { input: 2, output: 8 },
};

const DEFAULT_PRICE = { input: 0.25, output: 2 }; // fallback ~ giá gpt-5-mini

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

// Cộng dồn chi phí 2 lần gọi AI cho cùng 1 hồ sơ (vd: bước trích xuất +
// bước suy luận/tính toán riêng cho các trường 'infer').
export function addUsageCost(a: UsageCost, b: UsageCost): UsageCost {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedUsd: a.estimatedUsd + b.estimatedUsd,
  };
}
