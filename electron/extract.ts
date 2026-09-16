import OpenAI from 'openai';
import type { FieldDef, ExtractedRecord, CellNote } from './types';
import type { PdfContent } from './pdf';
import { estimateCost, addUsageCost } from './pricing';
import { NOT_FOUND_VALUE, FORMAT_MISMATCH_VALUE, INFER_MISSING_DATA_VALUE } from './noteValues';

export { NOT_FOUND_VALUE, FORMAT_MISMATCH_VALUE, INFER_MISSING_DATA_VALUE };

// OpenAI SDK tự retry 429/5xx vài lần rồi mới throw, nhưng độ trễ mặc định
// của SDK không đủ khi tổ chức đã sát hạn mức token/phút (retry-after thực
// tế OpenAI trả có thể tới hàng chục giây). Bọc thêm 1 lớp retry ở đây, đọc
// đúng số giây OpenAI yêu cầu qua header "retry-after" của RateLimitError
// thay vì đoán 1 khoảng cố định — tránh vừa retry sớm quá (vẫn bị 429) vừa
// chờ lâu quá không cần thiết.
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_FALLBACK_MS = 5000;

function retryAfterMs(err: unknown): number {
  if (err instanceof OpenAI.RateLimitError) {
    const header = err.headers?.get?.('retry-after');
    const seconds = header ? Number(header) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 500; // +500ms đệm an toàn
    }
  }
  return RATE_LIMIT_FALLBACK_MS;
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!(err instanceof OpenAI.RateLimitError) || attempt === RATE_LIMIT_MAX_RETRIES) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, retryAfterMs(err)));
    }
  }
  throw lastErr;
}

function buildSchema(fields: FieldDef[]) {
  const properties: Record<string, any> = {};
  for (const f of fields) {
    properties[f.key] = {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description:
            f.description +
            (f.example ? ` (ví dụ định dạng: "${f.example}")` : '') +
            ' — CHỈ giá trị copy/đọc nguyên văn từ tài liệu, không tự thêm chú' +
            ' thích/nhận xét của bạn (vd không thêm "(ước tính)", "(không rõ)").' +
            ` Nếu KHÔNG tìm thấy trường này trong tài liệu, value PHẢI là đúng` +
            ` nguyên văn "${NOT_FOUND_VALUE}". Nếu tìm thấy nhưng định dạng` +
            ` trong tài liệu không khớp định dạng yêu cầu ở mô tả/ví dụ trên` +
            ` (và không thể chuẩn hoá được), value PHẢI là đúng nguyên văn` +
            ` "${FORMAT_MISMATCH_VALUE}".`,
        },
        note: {
          type: 'string',
          description:
            'BẮT BUỘC điền (không để trống) trong MỌI trường hợp value không' +
            ' phải là đáp số đọc rõ ràng bình thường — xem mô tả field' +
            ' "noteType" để biết chính xác nội dung cần viết cho từng trường' +
            ' hợp. Để chuỗi rỗng "" nếu đọc được rõ ràng, đúng định dạng,' +
            ' không có gì cần lưu ý.',
        },
        noteType: {
          type: 'string',
          enum: ['uncertain', 'not_found', 'format_mismatch', 'none'],
          description:
            `"not_found" khi value = "${NOT_FOUND_VALUE}" — note giải thích` +
            ` đã tìm ở đâu/vì sao kết luận là không có. "format_mismatch" khi` +
            ` value = "${FORMAT_MISMATCH_VALUE}" — note PHẢI nêu rõ 2 vế: định` +
            ` dạng tài liệu ghi là gì, và định dạng field yêu cầu là gì (vd` +
            ` "Tài liệu ghi \\"Tháng 3/1992\\", field yêu cầu dd/mm/yyyy nên` +
            ` không tự suy ra được ngày cụ thể"). "uncertain" khi value có giá` +
            ` trị đọc được nhưng không chắc chắn (chữ mờ, 2 chỗ ghi khác nhau,` +
            ` v.v.) — note giải thích lý do không chắc. "none" khi value đọc` +
            ` được rõ ràng, đúng định dạng, không có gì cần lưu ý (note để` +
            ` trống).`,
        },
      },
      required: ['value', 'note', 'noteType'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties,
    required: fields.map((f) => f.key),
    additionalProperties: false,
  };
}

const SYSTEM_PROMPT = `Bạn là trợ lý trích xuất thông tin y tế từ hồ sơ bệnh nhân (tiếng Việt).
Chỉ trích xuất thông tin có thật trong tài liệu. Không suy đoán, không bịa.
Giữ nguyên dấu tiếng Việt. Ngày tháng chuẩn hóa về dd/mm/yyyy nếu có thể.

PHÂN LOẠI KẾT QUẢ (bắt buộc, chọn ĐÚNG 1 trong 4 trường hợp cho mỗi field):
1. Đọc được rõ ràng, đúng định dạng yêu cầu, không có gì cần lưu ý -> value là
   giá trị đọc được, note = "", noteType = "none".
2. Đọc được giá trị nhưng KHÔNG chắc chắn (chữ mờ, 2 chỗ trong tài liệu ghi
   khác nhau...) -> value vẫn là giá trị đọc được (đừng bỏ trống), noteType =
   "uncertain", note giải thích ngắn gọn lý do không chắc.
3. KHÔNG tìm thấy trường này ở bất kỳ đâu trong tài liệu -> value =
   "${NOT_FOUND_VALUE}", noteType = "not_found", note giải thích đã tìm ở đâu/
   vì sao kết luận là không có.
4. Tìm thấy nhưng định dạng trong tài liệu KHÔNG khớp định dạng field yêu cầu
   (mô tả hoặc ví dụ) và không thể tự chuẩn hoá đáng tin cậy -> value =
   "${FORMAT_MISMATCH_VALUE}", noteType = "format_mismatch", note PHẢI nêu rõ
   2 vế: định dạng tài liệu ghi là gì, và định dạng field yêu cầu là gì.

QUY TẮC ĐỊNH DẠNG value (bắt buộc, vì value sẽ ghi thẳng vào 1 ô Google Sheet):
- value CHỈ chứa giá trị đọc/copy được từ tài liệu (hoặc đúng 1 trong 2 chuỗi
  cố định ở trên) — không tự thêm chú thích, nhận xét, hay đánh giá của bạn
  vào trong value (vd không viết "85 kg (ước tính)", "Nguyễn Văn A (không
  rõ)"). Mọi giải thích đi vào field "note" riêng, KHÔNG trộn vào value.
- Với chỉ số/xét nghiệm có đơn vị đo trong tài liệu (kể cả khi tài liệu trình
  bày dạng bảng với đơn vị ở cột riêng, không nằm chung ô với con số) — LUÔN
  LUÔN kèm đơn vị vào value, cách nhau 1 dấu cách (vd "82 G/L", "45 U/L", "1.75
  m"), trừ khi field mô tả rõ ràng chỉ cần con số thuần. Áp dụng nhất quán cho
  MỌI trường có đơn vị, không tuỳ hứng — cùng 1 loại chỉ số phải luôn có/không
  có đơn vị giống nhau giữa các lần trích xuất.`;

// Model không nên dùng cho bước suy luận (web search) khi hồ sơ có field 'infer':
// gpt-5* với reasoning_effort tối thiểu cho kết quả web search kém tin cậy hơn
// hẳn so với gpt-4.1 (khuyến nghị của OpenAI) -> fallback sang gpt-4.1.
const INFER_FALLBACK_MODEL = 'gpt-4.1';
function inferModelFor(model: string): string {
  return /^gpt-5/.test(model) || /^o[0-9]/.test(model) ? INFER_FALLBACK_MODEL : model;
}

async function extractRaw(
  client: OpenAI,
  pdf: PdfContent,
  fields: FieldDef[],
  model: string
) {
  const fieldList = fields
    .map(
      (f) =>
        `- ${f.key}: ${f.label} — ${f.description}` +
        (f.example ? ` (ví dụ: ${f.example})` : '')
    )
    .join('\n');

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: `Trích xuất các trường sau từ hồ sơ bệnh nhân:\n${fieldList}\n\n${
        pdf.looksScanned
          ? 'Tài liệu là bản scan, đọc từ (các) ảnh bên dưới.'
          : `Nội dung tài liệu:\n"""\n${pdf.text}\n"""`
      }`,
    },
  ];

  if (pdf.looksScanned) {
    for (const img of pdf.pageImages) {
      userContent.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
    }
  }

  // Model reasoning đời 5: chỉ nhận temperature mặc định (1), và mặc định "suy nghĩ"
  // nhiều -> chậm + tốn token. Task trích xuất đơn giản nên đặt reasoning_effort tối thiểu.
  const isReasoning = /^gpt-5/.test(model) || /^o[0-9]/.test(model);
  const resp = await withRateLimitRetry(() =>
    client.chat.completions.create({
      model,
      ...(isReasoning ? { reasoning_effort: 'minimal' as const } : { temperature: 0 }),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'patient_record',
          strict: true,
          schema: buildSchema(fields),
        },
      },
    })
  );

  const raw = resp.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Record<
    string,
    { value: string; note?: string; noteType?: 'uncertain' | 'not_found' | 'format_mismatch' | 'none' }
  >;

  const values: Record<string, string> = {};
  const notes: Record<string, CellNote> = {};
  for (const f of fields) {
    let value = parsed[f.key]?.value ?? '';
    let noteType = parsed[f.key]?.noteType ?? 'none';
    let note = parsed[f.key]?.note?.trim() ?? '';

    // Chốt chặn code: suy noteType từ value nếu model lỡ trả lệch nhau, thay
    // vì tin tưởng hoàn toàn model tự nhất quán 2 field.
    if (value === NOT_FOUND_VALUE) noteType = 'not_found';
    else if (value === FORMAT_MISMATCH_VALUE) noteType = 'format_mismatch';
    else if (!value.trim()) {
      // model để value rỗng nhưng không dùng đúng chuỗi cố định -> coi như
      // không tìm thấy, tránh ô trống không rõ nghĩa.
      value = NOT_FOUND_VALUE;
      noteType = 'not_found';
    }

    if (noteType !== 'none' && !note) {
      note =
        noteType === 'not_found'
          ? 'Không tìm thấy trường này trong tài liệu.'
          : noteType === 'format_mismatch'
          ? 'Định dạng trong tài liệu không khớp định dạng yêu cầu.'
          : 'AI không chắc chắn về giá trị này.';
    }

    values[f.key] = value;
    if (noteType !== 'none') notes[f.key] = { type: noteType, text: note };
  }

  const usage = resp.usage
    ? estimateCost(model, resp.usage.prompt_tokens, resp.usage.completion_tokens)
    : undefined;

  return { values, notes, usage };
}

function buildInferSchema(fields: FieldDef[]) {
  const properties: Record<string, any> = {};
  for (const f of fields) {
    properties[f.key] = {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description:
            f.description +
            (f.example ? ` (ví dụ định dạng: "${f.example}")` : '') +
            ' — CHỈ đáp số/kết luận cuối cùng, không giải thích, không công' +
            ` thức, không markdown. Nếu KHÔNG đủ thông tin để ra kết quả đáng` +
            ` tin cậy, value PHẢI là đúng nguyên văn chuỗi` +
            ` "${INFER_MISSING_DATA_VALUE}" (không để rỗng, không viết khác đi).`,
        },
        note: {
          type: 'string',
          description:
            'BẮT BUỘC điền (không để trống) trong 2 trường hợp: (1) value là' +
            ` "${INFER_MISSING_DATA_VALUE}" — liệt kê CỤ THỂ những thông` +
            ' tin/số liệu còn thiếu cần bác sĩ bổ sung mới giải quyết được; (2)' +
            ' value chứa thông tin nằm NGOÀI phạm vi mô tả của field mà bạn tự' +
            ' nhận thấy suy luận được và hữu ích cho bác sĩ — giải thích ngắn' +
            ' gọn, khoa học về căn cứ/cách suy ra từ số liệu nào trong hồ sơ.' +
            ' Để chuỗi rỗng "" nếu value chỉ đơn thuần là đáp số đúng theo mô' +
            ' tả field đã yêu cầu, có đủ số liệu, không có gì cần lưu ý thêm.',
        },
        noteType: {
          type: 'string',
          enum: ['missing_info', 'inferred', 'none'],
          description:
            'Loại của "note": "missing_info" nếu note là lý do KHÔNG đủ thông' +
            ` tin (đi kèm value = "${INFER_MISSING_DATA_VALUE}"); "inferred"` +
            ' nếu note là giải thích cho thông tin suy luận thêm NGOÀI phạm vi' +
            ' field (value vẫn là đáp số đáng tin cậy bình thường); "none" nếu' +
            ' note để trống (không có gì cần lưu ý).',
        },
      },
      required: ['value', 'note', 'noteType'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties,
    required: fields.map((f) => f.key),
    additionalProperties: false,
  };
}

const INFER_SYSTEM_PROMPT = `Bạn là trợ lý y tế, suy luận/tính toán các chỉ số còn thiếu của MỘT bệnh nhân,
dựa trên hồ sơ gốc của bệnh nhân đó (đính kèm bên dưới), dữ liệu đã trích xuất sẵn,
và kiến thức chuyên môn (công thức, bảng chuẩn y khoa...). Ưu tiên đọc trực tiếp từ
hồ sơ gốc nếu dữ liệu đã trích xuất có vẻ thiếu/sai. Được phép tra cứu web khi cần
công thức hoặc số liệu tham chiếu cập nhật.

QUY TẮC AN TOÀN (bắt buộc, không thương lượng):
1. CHỈ được dùng các thông số/chỉ số CÓ THẬT trong hồ sơ (đính kèm) và dữ liệu
   đã trích xuất sẵn để suy luận/tính toán. Tuyệt đối không bịa, không giả
   định số liệu không có trong hồ sơ — đây là điều cấm kỵ trong y khoa.
2. Nếu KHÔNG thể ra kết quả đáng tin cậy vì bất kỳ lý do gì — thiếu số liệu
   bắt buộc, số liệu mâu thuẫn, hay kiến thức chuyên môn không đủ chắc chắn —
   value = đúng nguyên văn "${INFER_MISSING_DATA_VALUE}", noteType =
   "missing_info", note PHẢI liệt kê cụ thể thông tin/số liệu còn thiếu để bác
   sĩ biết cần bổ sung gì mới giải quyết được. Tuyệt đối không đoán liều,
   không để value rỗng.
3. Nếu trong lúc suy luận, bạn nhận thấy số liệu sẵn có trong hồ sơ còn cho
   phép suy ra THÊM một thông tin hữu ích cho bác sĩ mà field hiện tại KHÔNG
   yêu cầu (nằm ngoài phạm vi mô tả field) — được phép nêu trong value, nhưng
   noteType = "inferred" và note BẮT BUỘC giải thích ngắn gọn, khoa học về căn
   cứ/cách suy ra để bác sĩ tự kiểm chứng, không được âm thầm chèn thêm mà
   không giải thích.
4. Trường hợp thông thường (đủ số liệu, kết quả đúng theo mô tả field, không
   có gì cần lưu ý): note = "", noteType = "none".

QUY TẮC ĐỊNH DẠNG value (bắt buộc, vì value sẽ ghi thẳng vào 1 ô Google Sheet):
- Với phần đáp số ĐÚNG theo mô tả field đã yêu cầu: value CHỈ chứa đáp số/kết
  luận cuối cùng — không giải thích cách suy luận, không nêu công thức đã
  dùng, không liệt kê nguồn tham khảo, không lặp lại đề bài. Ví dụ ĐÚNG:
  "27.76". Ví dụ SAI: "BMI = 85/1.75² = 27.76", "Khoảng 27.76 (thừa cân)".
  Phần giải thích (nếu cần, theo quy tắc an toàn số 3) đi vào "note", KHÔNG
  trộn vào value.
- Số liệu: chỉ số + đơn vị nếu có (vd "27.76", "45 U/L"), không kèm khoảng tin
  cậy, không kèm đánh giá xu hướng trừ khi trường đó yêu cầu đúng vậy.
- Không dùng markdown (không **, không -, không backtick). Không có tiền tố
  kiểu "Kết quả:", "Đáp án:", "Value:". Chỉ xuống dòng khi bản chất giá trị
  cần liệt kê nhiều ý (vd tóm tắt nhiều chẩn đoán). Giữ nguyên dấu tiếng Việt.`;

// Bước 2: chỉ chạy khi hồ sơ có field mode='infer'. Gộp TẤT CẢ field infer của
// cùng hồ sơ vào 1 lần gọi Responses API (có tool web_search), kèm theo hồ sơ
// GỐC (ảnh scan hoặc text PDF, giống bước 1) + giá trị đã trích ở bước 1 làm
// ngữ cảnh -> không phụ thuộc hoàn toàn vào độ chính xác của bước 1, đổi lại
// tốn thêm chi phí gần bằng 1 lượt trích xuất nữa cho hồ sơ có field infer.
async function inferFields(
  client: OpenAI,
  pdf: PdfContent,
  extracted: Record<string, string>,
  allFields: FieldDef[],
  targetFields: FieldDef[],
  model: string
) {
  const contextList = allFields
    .filter((f) => (f.mode ?? 'extract') !== 'infer')
    .map((f) => `- ${f.label}: ${extracted[f.key] || '(trống)'}`)
    .join('\n');
  const targetList = targetFields
    .map(
      (f) =>
        `- ${f.key}: ${f.label} — ${f.description}` +
        (f.example ? ` (ví dụ định dạng: "${f.example}")` : '')
    )
    .join('\n');

  const promptText =
    `${INFER_SYSTEM_PROMPT}\n\nDữ liệu đã trích xuất sẵn của bệnh nhân này:\n${contextList}\n\n` +
    `Suy luận/tính toán các trường sau:\n${targetList}\n\n` +
    (pdf.looksScanned
      ? 'Hồ sơ gốc là bản scan, đọc từ (các) ảnh bên dưới.'
      : `Nội dung hồ sơ gốc:\n"""\n${pdf.text}\n"""`);

  const content: OpenAI.Responses.ResponseInputContent[] = [
    { type: 'input_text', text: promptText },
  ];
  if (pdf.looksScanned) {
    for (const img of pdf.pageImages) {
      content.push({ type: 'input_image', image_url: img, detail: 'high' });
    }
  }

  const resp = await withRateLimitRetry(() =>
    client.responses.create({
      model,
      tools: [{ type: 'web_search' }],
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'inferred_fields',
          strict: true,
          schema: buildInferSchema(targetFields),
        },
      },
    })
  );

  const parsed = JSON.parse(resp.output_text || '{}') as Record<
    string,
    { value: string; note?: string; noteType?: 'missing_info' | 'inferred' | 'none' }
  >;

  const values: Record<string, string> = {};
  const notes: Record<string, CellNote> = {};
  for (const f of targetFields) {
    let value = parsed[f.key]?.value ?? '';
    let noteType = parsed[f.key]?.noteType ?? 'none';
    let note = parsed[f.key]?.note?.trim() ?? '';
    // Chốt chặn code: value là chuỗi "thiếu thông tin" thì noteType luôn là
    // missing_info, dù model có lỡ trả sai noteType/để value rỗng thay vì
    // đúng chuỗi cố định — không phụ thuộc hoàn toàn vào model phân biệt đúng.
    if ((noteType === 'missing_info' || !value.trim()) && value !== INFER_MISSING_DATA_VALUE) {
      value = INFER_MISSING_DATA_VALUE;
    }
    if (value === INFER_MISSING_DATA_VALUE) {
      noteType = 'missing_info';
      if (!note) note = 'AI không đủ thông tin để đưa ra kết quả đáng tin cậy.';
    }
    values[f.key] = value;
    if (noteType !== 'none' && note) notes[f.key] = { type: noteType, text: note };
  }

  const usage = resp.usage
    ? estimateCost(model, resp.usage.input_tokens, resp.usage.output_tokens)
    : undefined;

  return { values, notes, usage };
}

// Thông báo cố định khi bước aggregate KHÔNG đủ căn cứ chọn ra 1 giá trị theo
// mô tả bác sĩ nhập — dùng chung với INFER_MISSING_DATA_VALUE để đồng nhất
// trải nghiệm giữa các bước (cùng 1 khái niệm "AI không kết luận được, cần
// bác sĩ biết vì sao"). Bước này không có khái niệm "suy luận thêm" (chỉ
// chọn/copy từ danh sách có sẵn) nên note chỉ có 1 loại: missing_info.
function buildAggregateSchema(fields: FieldDef[]) {
  const properties: Record<string, any> = {};
  for (const f of fields) {
    properties[f.key] = {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description:
            `Giá trị chốt sau khi lọc theo mô tả: "${f.aggregateDescription}"` +
            ' — CHỈ giá trị đã chốt, không giải thích lý do chọn, không' +
            ` markdown. Nếu mô tả yêu cầu CHỌN 1 đợt (lớn nhất/nhỏ nhất/gần` +
            ` nhất/nặng nhất...), copy nguyên văn giá trị đó từ danh sách gốc.` +
            ` Nếu mô tả yêu cầu TÍNH TOÁN số học (trung bình, tổng, chênh` +
            ` lệch...), value PHẢI là kết quả tính toán thực sự (vd cộng các` +
            ` giá trị rồi chia số lượng để ra trung bình) — tuyệt đối không` +
            ` copy đại 1 giá trị có sẵn trong danh sách để thay cho việc tính.` +
            ` Nếu KHÔNG đủ căn cứ để chọn/tính ra 1 giá trị đáng tin cậy theo` +
            ` mô tả, value PHẢI là đúng nguyên văn chuỗi` +
            ` "${INFER_MISSING_DATA_VALUE}" (không để rỗng, không viết khác đi).`,
        },
        note: {
          type: 'string',
          description:
            `BẮT BUỘC điền (không để trống) khi value là` +
            ` "${INFER_MISSING_DATA_VALUE}" — giải thích ngắn gọn lý do (vd` +
            ` "danh sách trống", "không có giá trị nào khớp mô tả", "giá trị` +
            ` không thể so sánh được"). Để chuỗi rỗng "" khi chọn được giá trị` +
            ` đáng tin cậy bình thường.`,
        },
      },
      required: ['value', 'note'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties,
    required: fields.map((f) => f.key),
    additionalProperties: false,
  };
}

const AGGREGATE_SYSTEM_PROMPT = `Bạn là trợ lý y tế. Với MỘT bệnh nhân, bạn nhận được danh sách giá trị của
1 hoặc nhiều chỉ số qua các đợt khám khác nhau, kèm mô tả cách bác sĩ muốn chốt
lại thành 1 giá trị duy nhất (vd "Lấy giá trị lớn nhất", "Lấy chẩn đoán nặng
nhất trong các đợt", "Lấy giá trị trung bình"). Áp dụng đúng mô tả cho từng chỉ
số, chỉ dựa trên các giá trị đã cho — không bịa thêm dữ liệu ngoài danh sách.
Giữ nguyên dấu tiếng Việt và đơn vị đo nếu có trong giá trị gốc.

PHÂN BIỆT 2 KIỂU MÔ TẢ (quan trọng, hay nhầm lẫn):
- Kiểu CHỌN 1 đợt (lớn nhất/nhỏ nhất/gần nhất/nặng nhất/mới nhất...): value là
  giá trị copy nguyên văn từ 1 phần tử có sẵn trong danh sách.
- Kiểu TÍNH TOÁN (trung bình, tổng, chênh lệch, tăng/giảm bao nhiêu %...):
  value PHẢI là kết quả tính toán số học thực sự trên các giá trị đã cho (vd
  trung bình = cộng tất cả rồi chia số lượng phần tử), giữ nguyên đơn vị đo.
  KHÔNG được copy đại 1 giá trị có sẵn trong danh sách để thay cho việc tính —
  đây là lỗi hay gặp nhất, tuyệt đối tránh.

SO SÁNH/TÍNH TOÁN VỚI GIÁ TRỊ KHÔNG PHẢI SỐ THUẦN (bắt buộc cố gắng, chỉ bỏ
cuộc khi thực sự không thể):
- Kích thước dạng "dài x rộng" (vd "106 x 88 mm", "117x83mm") -> so sánh theo
  diện tích ước tính (dài × rộng), bỏ qua khác biệt cách viết (có/không dấu
  cách quanh "x"/"×", đơn vị viết hoa/thường). Nếu mô tả yêu cầu trung bình,
  tính trung bình từng chiều (dài trung bình x rộng trung bình).
- Chuỗi có nhiều số/đơn vị lẫn nhau -> trích số chính đại diện cho đại lượng
  cần xử lý trước khi áp dụng mô tả (lớn nhất/nhỏ nhất/trung bình/...), đừng
  so sánh hay tính toán bằng cách so chuỗi ký tự.

KHI KHÔNG ĐỦ CĂN CỨ (bắt buộc, không thương lượng):
- CHỈ để value là thông báo thiếu căn cứ khi giá trị thực sự không thể diễn
  giải thành đại lượng so sánh được (vd danh sách trống hoàn toàn, hoặc mô tả
  không áp dụng được cho dữ liệu dạng này) — không lấy lý do "định dạng giữa
  các đợt không đồng nhất" (xem quy tắc so sánh ở trên).
- value = đúng nguyên văn "${INFER_MISSING_DATA_VALUE}" (không để chuỗi rỗng),
  và note PHẢI giải thích cụ thể lý do để bác sĩ biết cần làm gì tiếp theo.

QUY TẮC ĐỊNH DẠNG OUTPUT (bắt buộc, vì value sẽ ghi thẳng vào 1 ô Google Sheet):
- Khi có đủ căn cứ: value CHỈ chứa giá trị đã chốt (kiểu CHỌN 1 đợt: copy
  nguyên văn từ danh sách; kiểu TÍNH TOÁN: kết quả tính thực sự, xem phần
  PHÂN BIỆT 2 KIỂU MÔ TẢ ở trên), tuyệt đối không giải thích vì sao ra giá trị
  đó, không nêu "đợt thứ mấy", không liệt kê các giá trị còn lại hay công thức
  tính. Phần giải thích (nếu cần) đi vào "note", KHÔNG trộn vào value.
- Không dùng markdown (không **, không -, không backtick). Không có tiền tố
  kiểu "Kết quả:", "Giá trị chốt:".`;

export interface AggregateFilterField {
  key: string;
  label: string;
  /** mô tả cách chốt giá trị, do bác sĩ nhập ở Cài đặt */
  description: string;
  /** giá trị của trường này qua từng đợt khám của CÙNG bệnh nhân, theo thứ tự đợt */
  values: string[];
}

export interface AggregateFilterResult {
  values: Record<string, string>;
  notes: Record<string, CellNote>;
  usage?: ReturnType<typeof estimateCost>;
  error?: string;
}

// Lọc nâng cao bằng AI: gộp TẤT CẢ trường có aggregateDescription của CÙNG 1
// bệnh nhân vào 1 lần gọi. Chạy tự động ngay sau khi quét xong toàn bộ lô file
// (xem src/aggregateAi.ts), không cần web search — chỉ dựa trên giá trị đã
// trích xuất qua các đợt khám.
export async function aggregateFilter(
  fields: AggregateFilterField[],
  apiKey: string,
  model: string
): Promise<AggregateFilterResult> {
  if (fields.length === 0) return { values: {}, notes: {} };
  const client = new OpenAI({ apiKey });

  const fieldDefs = fields.map(
    (f): FieldDef => ({
      key: f.key,
      label: f.label,
      description: f.description,
      aggregateDescription: f.description,
    })
  );

  const fieldList = fields
    .map(
      (f) =>
        `- ${f.key}: ${f.label}\n  Mô tả cách chốt: ${f.description}\n  Giá trị qua các đợt: [${f.values
          .map((v) => `"${v || '(trống)'}"`)
          .join(', ')}]`
    )
    .join('\n');

  try {
    const isReasoning = /^gpt-5/.test(model) || /^o[0-9]/.test(model);
    const resp = await withRateLimitRetry(() =>
      client.chat.completions.create({
        model,
        ...(isReasoning ? { reasoning_effort: 'minimal' as const } : { temperature: 0 }),
        messages: [
          { role: 'system', content: AGGREGATE_SYSTEM_PROMPT },
          { role: 'user', content: `Chốt giá trị cho các chỉ số sau:\n${fieldList}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'aggregate_result',
            strict: true,
            schema: buildAggregateSchema(fieldDefs),
          },
        },
      })
    );

    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, { value: string; note?: string }>;

    const values: Record<string, string> = {};
    const notes: Record<string, CellNote> = {};
    for (const f of fields) {
      let value = parsed[f.key]?.value ?? '';
      let note = parsed[f.key]?.note?.trim() ?? '';
      // Chốt chặn code: value rỗng thì coi như thiếu căn cứ, ép về chuỗi
      // thông báo cố định thay vì để trống im lặng.
      if (!value.trim()) value = INFER_MISSING_DATA_VALUE;
      if (value === INFER_MISSING_DATA_VALUE && !note) {
        note = 'AI không đủ căn cứ để chọn ra 1 giá trị đáng tin cậy.';
      }
      values[f.key] = value;
      if (value === INFER_MISSING_DATA_VALUE) {
        notes[f.key] = { type: 'missing_info', text: note };
      }
    }

    const usage = resp.usage
      ? estimateCost(model, resp.usage.prompt_tokens, resp.usage.completion_tokens)
      : undefined;

    return { values, notes, usage };
  } catch (err: any) {
    const values: Record<string, string> = {};
    const notes: Record<string, CellNote> = {};
    for (const f of fields) {
      values[f.key] = INFER_MISSING_DATA_VALUE;
      notes[f.key] = { type: 'missing_info', text: 'Lỗi gọi AI: ' + (err?.message ?? String(err)) };
    }
    return { values, notes, error: err?.message ?? String(err) };
  }
}

export async function extractRecord(
  pdf: PdfContent,
  fields: FieldDef[],
  apiKey: string,
  model: string
): Promise<ExtractedRecord> {
  const client = new OpenAI({ apiKey });
  const extractOnly = fields.filter((f) => (f.mode ?? 'extract') !== 'infer');
  const inferOnly = fields.filter((f) => (f.mode ?? 'extract') === 'infer');

  try {
    const step1 = await extractRaw(client, pdf, extractOnly, model);

    let values = step1.values;
    let usage = step1.usage;
    let notes = step1.notes;

    if (inferOnly.length > 0) {
      try {
        const step2 = await inferFields(
          client,
          pdf,
          step1.values,
          fields,
          inferOnly,
          inferModelFor(model)
        );
        values = { ...values, ...step2.values };
        notes = { ...notes, ...step2.notes };
        if (usage && step2.usage) usage = addUsageCost(usage, step2.usage);
        else usage = usage ?? step2.usage;
      } catch (err: any) {
        // Bước suy luận lỗi -> vẫn giữ kết quả bước 1, chỉ đánh dấu các trường
        // infer là thiếu thông tin thay vì làm hỏng cả hồ sơ.
        for (const f of inferOnly) {
          values[f.key] = INFER_MISSING_DATA_VALUE;
          notes[f.key] = {
            type: 'missing_info',
            text: 'Lỗi khi gọi AI suy luận: ' + (err?.message ?? String(err)),
          };
        }
      }
    }

    return {
      values,
      notes,
      sourceFile: pdf.file,
      sourcePath: '',
      usage,
    };
  } catch (err: any) {
    const values: Record<string, string> = {};
    const notes: Record<string, CellNote> = {};
    for (const f of fields) {
      values[f.key] = '';
      notes[f.key] = { type: 'missing_info', text: err?.message ?? String(err) };
    }
    return {
      values,
      notes,
      sourceFile: pdf.file,
      sourcePath: '',
      error: err?.message ?? String(err),
    };
  }
}
