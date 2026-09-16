// Giá tham khảo OpenAI, USD / 1 triệu token (cập nhật thủ công khi giá đổi).
// App hiện chỉ dùng đúng 1 model (gpt-5.6-luna) cho mọi bước AI — trích xuất,
// suy luận/tính toán, và lọc giá trị nâng cao. Các model cũ (gpt-4.1-mini,
// gpt-5-mini, gpt-4.1) đã bỏ hẳn, chi phí của các lượt quét CŨ còn sót trong
// lịch sử/cache (nếu có) sẽ không còn tính đúng, rơi về giá fallback bên dưới.
const PRICING: Record<string, { input: number; output: number }> = {
  // NGUỒN CHƯA XÁC MINH — lấy từ developers.openai.com (không phải domain
  // chính thức platform.openai.com), trang ghi "knowledge cutoff: Feb 16,
  // 2026" (mâu thuẫn logic). Không có cách xác nhận độc lập số này đúng —
  // chi phí ước tính hiển thị cho model này có thể sai lệch so với hoá đơn
  // thật, cần đối chiếu lại tại platform.openai.com/usage.
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
};

const DEFAULT_PRICE = { input: 0.2, output: 1.2 }; // fallback = giá gpt-5.6-luna

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
