import OpenAI from 'openai';
import type { FieldDef, ExtractedRecord } from './types';
import type { PdfContent } from './pdf';
import { estimateCost } from './pricing';

function buildSchema(fields: FieldDef[]) {
  const properties: Record<string, any> = {};
  for (const f of fields) {
    properties[f.key] = {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description:
            f.description + (f.example ? ` (ví dụ định dạng: "${f.example}")` : ''),
        },
        uncertain: {
          type: 'boolean',
          description: 'true nếu không tìm thấy hoặc không chắc chắn về giá trị này',
        },
      },
      required: ['value', 'uncertain'],
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
Nếu một trường không có trong tài liệu, để value là chuỗi rỗng và uncertain = true.
Nếu tìm thấy nhưng chữ mờ/không rõ, vẫn điền value và đặt uncertain = true.
Giữ nguyên dấu tiếng Việt. Ngày tháng chuẩn hóa về dd/mm/yyyy nếu có thể.`;

export async function extractRecord(
  pdf: PdfContent,
  fields: FieldDef[],
  apiKey: string,
  model: string
): Promise<ExtractedRecord> {
  const client = new OpenAI({ apiKey });

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

  try {
    // Model reasoning đời 5: chỉ nhận temperature mặc định (1), và mặc định "suy nghĩ"
    // nhiều -> chậm + tốn token. Task trích xuất đơn giản nên đặt reasoning_effort tối thiểu.
    const isReasoning = /^gpt-5/.test(model) || /^o[0-9]/.test(model);
    const resp = await client.chat.completions.create({
      model,
      ...(isReasoning
        ? { reasoning_effort: 'minimal' as const }
        : { temperature: 0 }),
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
    });

    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Record<
      string,
      { value: string; uncertain: boolean }
    >;

    const values: Record<string, string> = {};
    const uncertain: Record<string, boolean> = {};
    for (const f of fields) {
      values[f.key] = parsed[f.key]?.value ?? '';
      uncertain[f.key] = parsed[f.key]?.uncertain ?? true;
    }

    const usage = resp.usage
      ? estimateCost(model, resp.usage.prompt_tokens, resp.usage.completion_tokens)
      : undefined;

    return { values, uncertain, sourceFile: pdf.file, sourcePath: '', usage };
  } catch (err: any) {
    const values: Record<string, string> = {};
    const uncertain: Record<string, boolean> = {};
    for (const f of fields) {
      values[f.key] = '';
      uncertain[f.key] = true;
    }
    return {
      values,
      uncertain,
      sourceFile: pdf.file,
      sourcePath: '',
      error: err?.message ?? String(err),
    };
  }
}
